"use client";

import { code } from "@streamdown/code";
import { defaultRehypePlugins, Streamdown } from "streamdown";

// Strict security config for AI-generated content
const rehypePlugins = [
  defaultRehypePlugins.raw,
  defaultRehypePlugins.sanitize,
  [
    defaultRehypePlugins.harden[0],
    {
      allowedProtocols: ["https", "mailto"],
      allowedLinkPrefixes: [
        "https://your-domain.com",
        "https://docs.your-domain.com",
      ],
      allowedImagePrefixes: ["https://cdn.your-domain.com"],
      allowDataImages: false,
    },
  ],
];

export default function SecureChat({ content }: { content: string }) {
  return (
    <Streamdown
      linkSafety={{
        enabled: true,
        onLinkCheck: (url) => {
          const trusted = ["your-domain.com"];
          const hostname = new URL(url).hostname;
          return trusted.some((d) => hostname.endsWith(d));
        },
      }}
      plugins={{ code }}
      rehypePlugins={rehypePlugins}
    >
      {content}
    </Streamdown>
  );
}
