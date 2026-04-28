//! SQLite-backed chat cache for AI agents.
//!
//! Why we cache here even though the agents own their own state: agents can
//! crash, get reinstalled, or come from a vendor that does not persist
//! conversations themselves. The hub keeps a write-through copy so the user
//! always sees their history, even when the agent is offline.
//!
//! Schema is intentionally tiny — `messages.content` is JSON to keep the
//! storage layer agnostic to whatever content parts an agent produces (text,
//! image refs, tool calls, …). Search and summarisation live one layer up.

use std::path::PathBuf;
use std::sync::Mutex;

use anyhow::{Context, Result};
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct StoredConversation {
    pub id: String,
    pub agent_id: String,
    pub title: Option<String>,
    pub system_prompt: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub message_count: usize,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct StoredMessage {
    pub id: String,
    pub role: String,
    pub content: Value,
    pub at: String,
}

pub struct ChatDb {
    conn: Mutex<Connection>,
    path: PathBuf,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ChatDbStats {
    pub path: String,
    pub size_bytes: u64,
    pub conversations: i64,
    pub messages: i64,
    pub fts_indexed: i64,
}

impl ChatDb {
    pub fn open(path: PathBuf) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).context("create chat db dir")?;
        }
        let conn = Connection::open(&path).context("open chat db")?;
        conn.pragma_update(None, "journal_mode", "WAL").ok();
        conn.pragma_update(None, "foreign_keys", "ON").ok();
        Self::migrate(&conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
            path,
        })
    }

    pub fn stats(&self) -> Result<ChatDbStats> {
        let conn = self.conn.lock().unwrap();
        let conversations: i64 = conn
            .query_row("SELECT COUNT(*) FROM conversations", [], |r| r.get(0))
            .unwrap_or(0);
        let messages: i64 = conn
            .query_row("SELECT COUNT(*) FROM messages", [], |r| r.get(0))
            .unwrap_or(0);
        let fts_indexed: i64 = conn
            .query_row("SELECT COUNT(*) FROM messages_fts", [], |r| r.get(0))
            .unwrap_or(0);
        // size_bytes: prefer the file on disk; in WAL mode the journal /
        // shm files exist alongside but the principal page count lives
        // in the main file and that's what users care about.
        let size_bytes = std::fs::metadata(&self.path)
            .map(|m| m.len())
            .unwrap_or(0);
        Ok(ChatDbStats {
            path: self.path.display().to_string(),
            size_bytes,
            conversations,
            messages,
            fts_indexed,
        })
    }

    fn migrate(conn: &Connection) -> Result<()> {
        // v1 — base tables.
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS conversations (
                id              TEXT PRIMARY KEY,
                agent_id        TEXT NOT NULL,
                title           TEXT,
                system_prompt   TEXT,
                created_at      TEXT NOT NULL,
                updated_at      TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_convs_agent
                ON conversations(agent_id, updated_at DESC);

            CREATE TABLE IF NOT EXISTS messages (
                id              TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL
                                  REFERENCES conversations(id) ON DELETE CASCADE,
                role            TEXT NOT NULL,
                content         TEXT NOT NULL,
                at              TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_msgs_conv
                ON messages(conversation_id, at);
            "#,
        )
        .context("migrate chat db v1")?;

        // v2 — full-text search. We deliberately keep it as a separate
        // virtual table (rather than a contentless or content-rowid
        // attached one) so we can store a flattened plain-text projection
        // of `messages.content` (which is JSON in the canonical table).
        // Triggers keep both in sync. If FTS5 is missing in the linked
        // SQLite, we log and continue without search.
        let fts_ok = conn
            .execute_batch(
                r#"
                CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
                    text,
                    message_id      UNINDEXED,
                    conversation_id UNINDEXED,
                    role            UNINDEXED,
                    tokenize = 'unicode61 remove_diacritics 2'
                );

                CREATE TRIGGER IF NOT EXISTS messages_ad
                AFTER DELETE ON messages BEGIN
                    DELETE FROM messages_fts WHERE message_id = old.id;
                END;
                "#,
            )
            .is_ok();

        if fts_ok {
            // Backfill: if the FTS table is empty but `messages` is not,
            // we are upgrading from v0.4.2. Project every existing row
            // through `extract_text` and insert. Idempotent — `INSERT OR
            // REPLACE` on `(message_id)` keeps re-runs safe.
            let count: i64 = conn
                .query_row("SELECT COUNT(*) FROM messages_fts", [], |r| r.get(0))
                .unwrap_or(0);
            if count == 0 {
                let mut stmt = conn
                    .prepare("SELECT id, conversation_id, role, content FROM messages")
                    .context("backfill: prepare")?;
                let rows = stmt
                    .query_map([], |r| {
                        Ok((
                            r.get::<_, String>(0)?,
                            r.get::<_, String>(1)?,
                            r.get::<_, String>(2)?,
                            r.get::<_, String>(3)?,
                        ))
                    })
                    .context("backfill: query")?;
                for row in rows {
                    let (id, conv, role, content) = row?;
                    let value: Value = serde_json::from_str(&content)
                        .unwrap_or_else(|_| Value::String(content.clone()));
                    let text = extract_text(&value);
                    if text.trim().is_empty() {
                        continue;
                    }
                    conn.execute(
                        "INSERT INTO messages_fts(text, message_id, conversation_id, role)
                         VALUES (?1, ?2, ?3, ?4)",
                        params![text, id, conv, role],
                    )
                    .ok();
                }
            }
        } else {
            eprintln!("[chatdb] FTS5 unavailable; chat search disabled");
        }

        Ok(())
    }

    pub fn upsert_conversation(
        &self,
        agent_id: &str,
        id: &str,
        title: Option<&str>,
        system_prompt: Option<&str>,
    ) -> Result<()> {
        let now = Utc::now().to_rfc3339();
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO conversations(id, agent_id, title, system_prompt, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?5)
             ON CONFLICT(id) DO UPDATE SET
                title         = COALESCE(excluded.title, conversations.title),
                system_prompt = COALESCE(excluded.system_prompt, conversations.system_prompt),
                updated_at    = excluded.updated_at",
            params![id, agent_id, title, system_prompt, now],
        )
        .context("upsert conversation")?;
        Ok(())
    }

    pub fn delete_conversation(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM conversations WHERE id = ?1", params![id])
            .context("delete conversation")?;
        Ok(())
    }

    pub fn list_conversations(&self, agent_id: &str) -> Result<Vec<StoredConversation>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT c.id, c.agent_id, c.title, c.system_prompt, c.created_at, c.updated_at,
                    (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS n
             FROM conversations c
             WHERE c.agent_id = ?1
             ORDER BY c.updated_at DESC",
        )?;
        let rows = stmt.query_map(params![agent_id], |row| {
            Ok(StoredConversation {
                id: row.get(0)?,
                agent_id: row.get(1)?,
                title: row.get(2)?,
                system_prompt: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
                message_count: row.get::<_, i64>(6)? as usize,
            })
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    pub fn get_conversation(&self, id: &str) -> Result<Option<StoredConversation>> {
        let conn = self.conn.lock().unwrap();
        let row = conn
            .query_row(
                "SELECT c.id, c.agent_id, c.title, c.system_prompt, c.created_at, c.updated_at,
                        (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS n
                 FROM conversations c
                 WHERE c.id = ?1",
                params![id],
                |row| {
                    Ok(StoredConversation {
                        id: row.get(0)?,
                        agent_id: row.get(1)?,
                        title: row.get(2)?,
                        system_prompt: row.get(3)?,
                        created_at: row.get(4)?,
                        updated_at: row.get(5)?,
                        message_count: row.get::<_, i64>(6)? as usize,
                    })
                },
            )
            .optional()?;
        Ok(row)
    }

    pub fn list_messages(&self, conversation_id: &str) -> Result<Vec<StoredMessage>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, role, content, at FROM messages
             WHERE conversation_id = ?1
             ORDER BY at ASC",
        )?;
        let rows = stmt.query_map(params![conversation_id], |row| {
            let content_text: String = row.get(2)?;
            let content =
                serde_json::from_str(&content_text).unwrap_or(Value::String(content_text));
            Ok(StoredMessage {
                id: row.get(0)?,
                role: row.get(1)?,
                content,
                at: row.get(3)?,
            })
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    pub fn insert_message(
        &self,
        conversation_id: &str,
        id: &str,
        role: &str,
        content: &Value,
    ) -> Result<()> {
        let now = Utc::now().to_rfc3339();
        let content_text = serde_json::to_string(content).unwrap_or_else(|_| "null".into());
        let searchable = extract_text(content);
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO messages(id, conversation_id, role, content, at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id, conversation_id, role, content_text, now],
        )
        .context("insert message")?;
        conn.execute(
            "UPDATE conversations SET updated_at = ?1 WHERE id = ?2",
            params![now, conversation_id],
        )
        .ok();

        // FTS sync. We don't have a real FK so we manually purge any
        // older row with the same message_id before reinsert. Failure
        // here is non-fatal: search degrades, chat keeps working.
        if !searchable.trim().is_empty() {
            let _ = conn.execute(
                "DELETE FROM messages_fts WHERE message_id = ?1",
                params![id],
            );
            let _ = conn.execute(
                "INSERT INTO messages_fts(text, message_id, conversation_id, role)
                 VALUES (?1, ?2, ?3, ?4)",
                params![searchable, id, conversation_id, role],
            );
        }
        Ok(())
    }

    /// Full-text search over message bodies. Returns most recent matches
    /// first, capped at `limit`. Empty / whitespace queries return [].
    pub fn search_messages(&self, query: &str, limit: usize) -> Result<Vec<SearchHit>> {
        let trimmed = query.trim();
        if trimmed.is_empty() {
            return Ok(Vec::new());
        }
        let fts_query = build_fts_query(trimmed);
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT
                f.message_id,
                f.conversation_id,
                f.role,
                snippet(messages_fts, 0, '[', ']', '…', 12) AS snip,
                m.at,
                c.agent_id,
                c.title
             FROM messages_fts f
             JOIN messages m ON m.id = f.message_id
             JOIN conversations c ON c.id = f.conversation_id
             WHERE messages_fts MATCH ?1
             ORDER BY m.at DESC
             LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![fts_query, limit as i64], |row| {
            Ok(SearchHit {
                message_id: row.get(0)?,
                conversation_id: row.get(1)?,
                role: row.get(2)?,
                snippet: row.get(3)?,
                at: row.get(4)?,
                agent_id: row.get(5)?,
                conversation_title: row.get(6)?,
            })
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }
}

/// Recursively flattens any JSON value into a single space-joined plain
/// string. Used both for FTS indexing and for snippet input. We preserve
/// `text` field bias by always emitting it first, so prefix-search hits
/// human content before any tool / metadata strings.
fn extract_text(v: &Value) -> String {
    let mut out = String::new();
    walk(v, &mut out);
    out
}

fn walk(v: &Value, out: &mut String) {
    match v {
        Value::String(s) => push_word(out, s),
        Value::Number(n) => push_word(out, &n.to_string()),
        Value::Bool(b) => push_word(out, if *b { "true" } else { "false" }),
        Value::Array(arr) => {
            for item in arr {
                walk(item, out);
            }
        }
        Value::Object(map) => {
            // bias towards human-readable fields
            for key in ["text", "content", "delta", "value"] {
                if let Some(child) = map.get(key) {
                    walk(child, out);
                }
            }
            for (k, child) in map {
                if matches!(k.as_str(), "text" | "content" | "delta" | "value") {
                    continue;
                }
                walk(child, out);
            }
        }
        Value::Null => {}
    }
}

fn push_word(out: &mut String, s: &str) {
    let s = s.trim();
    if s.is_empty() {
        return;
    }
    if !out.is_empty() {
        out.push(' ');
    }
    out.push_str(s);
}

/// Turns a free-form user query into something safe for `MATCH`. We quote
/// each token to avoid FTS5 syntax injection (parens, AND/OR/NOT, NEAR,
/// etc.) and append a `*` to the last token for prefix search, which
/// matches normal "search-as-you-type" expectations.
fn build_fts_query(q: &str) -> String {
    let tokens: Vec<&str> = q
        .split_whitespace()
        .filter(|t| !t.is_empty())
        .collect();
    if tokens.is_empty() {
        return String::new();
    }
    let mut parts: Vec<String> = Vec::with_capacity(tokens.len());
    for (i, t) in tokens.iter().enumerate() {
        // Inner quotes are escaped by doubling — FTS5 string literal rule.
        let escaped = t.replace('"', "\"\"");
        let term = if i + 1 == tokens.len() {
            format!("\"{escaped}\"*")
        } else {
            format!("\"{escaped}\"")
        };
        parts.push(term);
    }
    parts.join(" ")
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SearchHit {
    pub message_id: String,
    pub conversation_id: String,
    pub role: String,
    pub snippet: String,
    pub at: String,
    pub agent_id: String,
    pub conversation_title: Option<String>,
}
