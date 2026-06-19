import { readFile } from "fs/promises"
import path from "path"

type OpsSourceDoc = {
  title: string
  filename: string
  body: string
}

const SOURCE_FILES = [
  {
    title: "SUMO Bible Draft 5",
    filename: "SUMO_Bible_draft_5.txt",
  },
  {
    title: "Sumo MM Communications and Conduct",
    filename: "Sumo MM Communications and Conduct.txt",
  },
]

let cache: OpsSourceDoc[] | null = null

export async function getOpsSourceDocs() {
  if (cache) return cache
  const sourceDir = path.join(process.cwd(), "public", "Sources")
  cache = await Promise.all(
    SOURCE_FILES.map(async (source) => ({
      ...source,
      body: await readFile(path.join(sourceDir, source.filename), "utf8"),
    })),
  ).catch(() => [])
  return cache
}
