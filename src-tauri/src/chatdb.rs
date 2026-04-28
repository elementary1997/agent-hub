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
        })
    }

    fn migrate(conn: &Connection) -> Result<()> {
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
        .context("migrate chat db")?;
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
        Ok(())
    }
}
