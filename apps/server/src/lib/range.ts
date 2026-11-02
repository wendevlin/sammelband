import type { BunFile } from "bun";

// HTTP range requests: video players load a file in parts and jump to any
// position by asking for the bytes there. One range per request, as players do.

/** The bytes a `Range` header asks for, inclusive; null for the whole file; "invalid" if none fit. */
export function parseRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | null | "invalid" {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, from = "", to = ""] = match;
  if (from === "" && to === "") return "invalid";
  let start: number;
  let end: number;
  if (from === "") {
    // The last `to` bytes.
    const suffix = Number(to);
    if (suffix === 0) return "invalid";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(from);
    end = to === "" ? size - 1 : Math.min(Number(to), size - 1);
  }
  if (start >= size || start > end) return "invalid";
  return { start, end };
}

/** A file, or the part of it that `range` asks for. */
export function serveFile(
  file: BunFile,
  range: string | undefined,
  headers: Record<string, string>,
): Response {
  const size = file.size;
  const part = parseRange(range, size);
  const common = { ...headers, "Accept-Ranges": "bytes" };
  if (part === "invalid") {
    return new Response(null, {
      status: 416,
      headers: { ...common, "Content-Range": `bytes */${size}` },
    });
  }
  if (part === null) {
    return new Response(file, { headers: { ...common, "Content-Length": String(size) } });
  }
  return new Response(file.slice(part.start, part.end + 1), {
    status: 206,
    headers: {
      ...common,
      "Content-Range": `bytes ${part.start}-${part.end}/${size}`,
      "Content-Length": String(part.end - part.start + 1),
    },
  });
}
