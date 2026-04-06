import type TurndownService from "turndown";

let turndownPromise: Promise<TurndownService> | undefined;

export async function getTurndownService(): Promise<TurndownService> {
  return (turndownPromise ??= (async () => {
    const [turndownMod, gfmMod] = await Promise.all([
      import("turndown"),
      // @ts-expect-error no type declarations for turndown-plugin-gfm
      import("turndown-plugin-gfm"),
    ]);

    const Turndown = (turndownMod as any).default;
    const gfm = (gfmMod as any).gfm ?? gfmMod;

    const service = new Turndown({
      headingStyle: "atx",
      hr: "---",
      bulletListMarker: "-",
      codeBlockStyle: "fenced",
      fence: "```",
      emDelimiter: "_",
      strongDelimiter: "**",
      linkStyle: "inlined",
      linkReferenceStyle: "full",
    });

    service.use(gfm);
    service.remove(["script", "style", "nav", "header", "footer", "aside"]);

    return service;
  })());
}
