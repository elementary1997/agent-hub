import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { cn } from "@/lib/cn";

import "highlight.js/styles/github-dark.css";

interface MarkdownProps {
  children: string;
  className?: string;
}

export function Markdown({ children, className }: MarkdownProps) {
  return (
    <div className={cn("md leading-relaxed", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          a: (props) => (
            <a
              {...props}
              target="_blank"
              rel="noreferrer noopener"
              className="text-sky-400 hover:underline"
            />
          ),
          code({ className, children, ...props }) {
            const isBlock = /language-/.test(className ?? "");
            if (isBlock) {
              return (
                <code className={className} {...props}>
                  {children}
                </code>
              );
            }
            return (
              <code
                className="px-1.5 py-0.5 rounded bg-bg-elev border border-border-subtle text-[12.5px]"
                {...props}
              >
                {children}
              </code>
            );
          },
          pre: (props) => (
            <pre
              {...props}
              className="overflow-x-auto rounded-lg border border-border-subtle bg-bg-elev p-3 text-[12.5px]"
            />
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
