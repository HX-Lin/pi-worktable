import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

function HtmlPreview({ html }: { html: string }) {
  const [showSource, setShowSource] = useState(false);
  return (
    <div className="html-preview">
      <div className="html-preview-bar">
        <span>HTML 预览</span>
        <button type="button" onClick={() => setShowSource((value) => !value)}>
          {showSource ? "隐藏源码" : "查看源码"}
        </button>
      </div>
      {/* sandbox without allow-same-origin: unique opaque origin, no access to the app. */}
      <iframe title="html-preview" sandbox="allow-scripts" srcDoc={html} />
      {showSource && <pre className="html-source">{html}</pre>}
    </div>
  );
}

export function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code(props) {
            const { className, children } = props;
            const language = /language-([\w-]+)/.exec(className ?? "")?.[1];
            if (language === "html") return <HtmlPreview html={String(children ?? "")} />;
            return <code className={className}>{children}</code>;
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
