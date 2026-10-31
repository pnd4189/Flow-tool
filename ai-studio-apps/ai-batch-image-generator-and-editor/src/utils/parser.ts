import { PromptItem } from "../types";

export interface ParsingStrategy {
  type: "scene-marker" | "markdown-heading" | "horizontal-divider" | "numbered-list" | "bullet-list" | "double-newline";
  label: string;
  count: number;
}

/**
 * Detects the most prominent delimiter pattern in the text
 */
export function detectParsingStrategy(text: string): ParsingStrategy {
  if (!text || !text.trim()) {
    return { type: "double-newline", label: "Empty Content", count: 0 };
  }

  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");

  // 1. Check Custom Scene Markers
  // Matches e.g., "--- SCENE 001 ---", "SCENE 1:", "[CẢNH 2]", "PHÂN CẢNH 3", "--- PROMPT 4 ---"
  const markerRegex = /^(?:---|===)?\s*(SCENE|CẢNH|PHÂN CẢNH|PROMPT)\s+\d+.*$/i;
  let markerCount = 0;
  for (const line of lines) {
    if (markerRegex.test(line.trim())) {
      markerCount++;
    }
  }

  // 2. Check Markdown Headings
  // Matches e.g., "## Scene 1", "# Prompt Description"
  const headingRegex = /^#{1,6}\s+.+$/;
  let headingCount = 0;
  for (const line of lines) {
    if (headingRegex.test(line.trim())) {
      headingCount++;
    }
  }

  // 3. Check Horizontal Dividers
  // Matches lines of 3 or more -, =, * or _
  const dividerRegex = /^(?:-{3,}|={3,}|\*{3,}|_{3,})$/;
  let dividerCount = 0;
  for (const line of lines) {
    if (dividerRegex.test(line.trim())) {
      dividerCount++;
    }
  }

  // 4. Check Numbered Lists
  // Matches e.g., "1. Wide shot", "2) Cozy room"
  const numberedRegex = /^\s*\d+[\.\)]\s+.+$/;
  let numberedCount = 0;
  for (const line of lines) {
    if (numberedRegex.test(line.trim())) {
      numberedCount++;
    }
  }

  // 5. Check Bullet Lists
  // Matches e.g., "- Beautiful day", "* Mystic sky", "• Ambient light"
  const bulletRegex = /^\s*[-*•]\s+.+$/;
  let bulletCount = 0;
  for (const line of lines) {
    if (bulletRegex.test(line.trim())) {
      bulletCount++;
    }
  }

  // 6. Check double newline splits
  const doubleNewlineCount = normalized.split(/\n\s*\n+/).filter(p => p.trim()).length;

  // Decide strategy based on strict priority or count
  if (markerCount > 0) {
    return { type: "scene-marker", label: "Scene Markers (--- SCENE ---)", count: markerCount };
  }
  if (headingCount > 0) {
    return { type: "markdown-heading", label: "Markdown Headings (# Heading)", count: headingCount };
  }
  if (dividerCount > 0) {
    return { type: "horizontal-divider", label: "Horizontal Lines (---)", count: dividerCount + 1 };
  }
  if (numberedCount >= 2) {
    return { type: "numbered-list", label: "Numbered List (1., 2.)", count: numberedCount };
  }
  if (bulletCount >= 2) {
    return { type: "bullet-list", label: "Bullet List (-, *, •)", count: bulletCount };
  }

  return { type: "double-newline", label: "Paragraph Gaps (Double Enter)", count: doubleNewlineCount };
}

/**
 * Parses screenplay or list of prompts based on detected parsing strategy
 */
export function parsePromptText(text: string): PromptItem[] {
  if (!text || !text.trim()) return [];

  const normalized = text.replace(/\r\n/g, "\n");
  const strategy = detectParsingStrategy(normalized);
  const lines = normalized.split("\n");

  let blocks: { title: string; content: string }[] = [];

  switch (strategy.type) {
    case "scene-marker": {
      const markerRegex = /^(?:---|===)?\s*(SCENE|CẢNH|PHÂN CẢNH|PROMPT)\s*(\d+|\w+)?(?:\s*---?|\s*===?|:|\s*\]|\s*$)/i;
      let currentTitle = "SCENE 001";
      let currentContent: string[] = [];
      let index = 1;

      for (const line of lines) {
        const trimmed = line.trim();
        const match = trimmed.match(markerRegex);
        if (match) {
          if (currentContent.length > 0 || blocks.length > 0) {
            blocks.push({
              title: currentTitle,
              content: currentContent.join("\n").trim(),
            });
            currentContent = [];
          }
          const labelType = match[1].toUpperCase();
          const sceneNum = match[2] || String(index);
          currentTitle = `${labelType} ${sceneNum}`;
          index++;
        } else {
          currentContent.push(line);
        }
      }
      if (currentContent.length > 0 || blocks.length === 0) {
        blocks.push({
          title: currentTitle,
          content: currentContent.join("\n").trim(),
        });
      }
      break;
    }

    case "markdown-heading": {
      const headingRegex = /^#{1,6}\s+(.+)$/;
      let currentTitle = "PROMPT 001";
      let currentContent: string[] = [];
      let index = 1;

      for (const line of lines) {
        const trimmed = line.trim();
        const match = trimmed.match(headingRegex);
        if (match) {
          if (currentContent.length > 0 || blocks.length > 0) {
            blocks.push({
              title: currentTitle,
              content: currentContent.join("\n").trim(),
            });
            currentContent = [];
          }
          currentTitle = match[1].toUpperCase();
          index++;
        } else {
          currentContent.push(line);
        }
      }
      if (currentContent.length > 0 || blocks.length === 0) {
        blocks.push({
          title: currentTitle,
          content: currentContent.join("\n").trim(),
        });
      }
      break;
    }

    case "horizontal-divider": {
      const dividerRegex = /^(?:-{3,}|={3,}|\*{3,}|_{3,})$/;
      let currentTitle = "SCENE 001";
      let currentContent: string[] = [];
      let index = 1;

      for (const line of lines) {
        const trimmed = line.trim();
        if (dividerRegex.test(trimmed)) {
          if (currentContent.length > 0 || blocks.length > 0) {
            blocks.push({
              title: currentTitle,
              content: currentContent.join("\n").trim(),
            });
            currentContent = [];
          }
          currentTitle = `SCENE ${String(index).padStart(3, "0")}`;
          index++;
        } else {
          currentContent.push(line);
        }
      }
      if (currentContent.length > 0 || blocks.length === 0) {
        blocks.push({
          title: currentTitle,
          content: currentContent.join("\n").trim(),
        });
      }
      break;
    }

    case "numbered-list": {
      const numberedRegex = /^\s*(\d+)[\.\)]\s+(.+)$/;
      let currentTitle = "PROMPT 001";
      let currentContent: string[] = [];

      for (const line of lines) {
        const match = line.match(numberedRegex);
        if (match) {
          if (currentContent.length > 0 || blocks.length > 0) {
            blocks.push({
              title: currentTitle,
              content: currentContent.join("\n").trim(),
            });
          }
          currentTitle = `PROMPT ${String(match[1]).padStart(3, "0")}`;
          currentContent = [match[2]];
        } else if (currentContent.length > 0) {
          currentContent.push(line);
        }
      }
      if (currentContent.length > 0) {
        blocks.push({
          title: currentTitle,
          content: currentContent.join("\n").trim(),
        });
      }
      break;
    }

    case "bullet-list": {
      const bulletRegex = /^\s*[-*•]\s+(.+)$/;
      let currentTitle = "PROMPT 001";
      let currentContent: string[] = [];
      let index = 1;

      for (const line of lines) {
        const match = line.match(bulletRegex);
        if (match) {
          if (currentContent.length > 0 || blocks.length > 0) {
            blocks.push({
              title: currentTitle,
              content: currentContent.join("\n").trim(),
            });
          }
          currentTitle = `PROMPT ${String(index).padStart(3, "0")}`;
          currentContent = [match[1]];
          index++;
        } else if (currentContent.length > 0) {
          currentContent.push(line);
        }
      }
      if (currentContent.length > 0) {
        blocks.push({
          title: currentTitle,
          content: currentContent.join("\n").trim(),
        });
      }
      break;
    }

    case "double-newline":
    default: {
      const paragraphs = normalized.split(/\n\s*\n+/);
      let index = 1;
      for (const para of paragraphs) {
        if (para.trim()) {
          blocks.push({
            title: `PROMPT ${String(index).padStart(3, "0")}`,
            content: para.trim(),
          });
          index++;
        }
      }
      break;
    }
  }

  // Parse each detected block into a structured PromptItem
  return blocks.map((block, idx) => {
    const blockLines = block.content.split("\n");
    const fields: { [key: string]: string } = {};
    let isStructured = false;

    // Try to parse key-value pairs
    for (const line of blockLines) {
      const separatorIndex = line.indexOf(":");
      if (separatorIndex > 0 && separatorIndex < 30) {
        const key = line.substring(0, separatorIndex).trim().toLowerCase();
        const value = line.substring(separatorIndex + 1).trim();
        if (
          value &&
          [
            "camera",
            "story dna",
            "setting",
            "composition",
            "subject",
            "action / energy",
            "style",
            "lighting / color",
            "atmosphere",
            "negative",
          ].includes(key)
        ) {
          fields[key] = value;
          isStructured = true;
        }
      }
    }

    let cleanedPrompt = "";
    let negativePrompt = "";
    let aspectRatio = "1:1";

    if (isStructured) {
      // Build high-quality combined prompt
      const promptParts = [];

      if (fields["subject"]) promptParts.push(fields["subject"]);
      if (fields["action / energy"]) promptParts.push(fields["action / energy"]);
      if (fields["setting"]) promptParts.push(fields["setting"]);
      if (fields["style"]) promptParts.push(fields["style"]);
      if (fields["lighting / color"]) promptParts.push(fields["lighting / color"]);
      if (fields["atmosphere"]) promptParts.push(fields["atmosphere"]);
      if (fields["composition"]) promptParts.push(fields["composition"]);
      if (fields["camera"]) promptParts.push(fields["camera"]);

      cleanedPrompt = promptParts.join(". ");
      negativePrompt = fields["negative"] || "";

      // Try to detect aspect ratio requested in style or composition
      const ratioMatch = block.content.match(/(\d+:\d+)\s*(aspect ratio|ratio)/i);
      if (ratioMatch) {
        aspectRatio = ratioMatch[1];
      } else if (block.content.toLowerCase().includes("16:9")) {
        aspectRatio = "16:9";
      } else if (block.content.toLowerCase().includes("9:16")) {
        aspectRatio = "9:16";
      } else if (block.content.toLowerCase().includes("4:3")) {
        aspectRatio = "4:3";
      } else if (block.content.toLowerCase().includes("3:4")) {
        aspectRatio = "3:4";
      }
    } else {
      // Simple text prompt - clean up
      const cleanParts = [];
      for (const l of blockLines) {
        const trimmedLine = l.trim();
        if (trimmedLine.toLowerCase().startsWith("negative:") || trimmedLine.toLowerCase().startsWith("avoid:")) {
          negativePrompt = trimmedLine.replace(/^(negative|avoid):/i, "").trim();
        } else {
          cleanParts.push(l);
        }
      }
      cleanedPrompt = cleanParts.join(" ").replace(/\s+/g, " ").trim();

      // Detect aspect ratio for unstructured prompt
      const ratioMatch = block.content.match(/(\d+:\d+)\s*(aspect ratio|ratio)/i);
      if (ratioMatch) {
        aspectRatio = ratioMatch[1];
      } else if (block.content.toLowerCase().includes("16:9")) {
        aspectRatio = "16:9";
      } else if (block.content.toLowerCase().includes("9:16")) {
        aspectRatio = "9:16";
      } else if (block.content.toLowerCase().includes("4:3")) {
        aspectRatio = "4:3";
      } else if (block.content.toLowerCase().includes("3:4")) {
        aspectRatio = "3:4";
      }
    }

    return {
      id: `prompt-${idx}-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      index: idx + 1,
      title: block.title,
      originalText: block.content.trim(),
      cleanedPrompt: cleanedPrompt || block.content.trim(),
      negativePrompt: negativePrompt,
      aspectRatio: aspectRatio,
      status: "idle",
    };
  });
}
