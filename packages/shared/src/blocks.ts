// Album blocks: their types and the JSON stored in a block's `content`.

export type BlockType = "heading" | "text" | "gallery" | "group";

export type HeadingContent = { level?: number; text?: string };
export type TextContent = { markdown?: string };
export type GroupBackground = "none" | "auto" | "neutral" | "blue" | "green" | "amber" | "rose";
export type GroupContent = { background?: GroupBackground };

/** A block's content, or {} when it isn't valid JSON. */
export function parseContent<T>(block: { content: string }): T {
  try {
    return JSON.parse(block.content) as T;
  } catch {
    return {} as T;
  }
}
