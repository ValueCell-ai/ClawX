import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { Streamdown } from "streamdown";
import "katex/dist/katex.min.css";

export default function BlogPost({ content }: { content: string }) {
  return (
    <Streamdown
      linkSafety={{ enabled: false }}
      mode="static"
      plugins={{ code, math }}
      shikiTheme={["github-light", "github-dark"]}
    >
      {content}
    </Streamdown>
  );
}
