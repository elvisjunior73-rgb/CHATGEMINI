import fs from "node:fs/promises";
import path from "node:path";
import { GoogleGenAI } from "@google/genai";

const jobsDir = "jobs";
const resultsDir = "results";
const model = process.env.VEO_MODEL || "veo-3.1-generate-preview";

if (!process.env.GEMINI_API_KEY) throw new Error("Missing GEMINI_API_KEY GitHub Secret");

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
await fs.mkdir(resultsDir, { recursive: true });
const names = (await fs.readdir(jobsDir)).filter((n) => n.endsWith(".json")).sort();

for (const name of names) {
  const jobPath = path.join(jobsDir, name);
  const job = JSON.parse(await fs.readFile(jobPath, "utf8"));
  if (job.status !== "TODO" || job.type !== "VIDEO") continue;
  const id = job.id || path.basename(name, ".json");
  const outputPath = path.join(resultsDir, `${id}.mp4`);
  const statusPath = path.join(resultsDir, `${id}.json`);
  try {
    await fs.writeFile(statusPath, JSON.stringify({ ...job, status:"RUNNING", startedAt:new Date().toISOString() }, null, 2));
    let operation = await ai.models.generateVideos({ model, prompt:job.prompt, config:{ aspectRatio:job.aspectRatio||"9:16", resolution:job.resolution||"720p", numberOfVideos:1 } });
    while (!operation.done) { await new Promise(r=>setTimeout(r,10000)); operation=await ai.operations.getVideosOperation({operation}); }
    const generated=operation.response?.generatedVideos?.[0]?.video;
    if (!generated) throw new Error("Veo returned no generated video");
    await ai.files.download({file:generated,downloadPath:outputPath});
    await fs.writeFile(statusPath, JSON.stringify({...job,status:"DONE",finishedAt:new Date().toISOString(),artifact:outputPath,engine:model},null,2));
  } catch(error) {
    await fs.writeFile(statusPath, JSON.stringify({...job,status:"ERROR",finishedAt:new Date().toISOString(),error:error instanceof Error?error.message:String(error)},null,2));
    process.exitCode=1;
  }
}