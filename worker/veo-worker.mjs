import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { GoogleGenAI } from "@google/genai";
const execFileAsync=promisify(execFile);
const jobsDir="jobs",resultsDir="results";
const model=process.env.VEO_MODEL||"veo-3.1-generate-preview";
if(!process.env.GEMINI_API_KEY)throw new Error("Missing GEMINI_API_KEY GitHub Secret");
const ai=new GoogleGenAI({apiKey:process.env.GEMINI_API_KEY});
await fs.mkdir(resultsDir,{recursive:true});
const names=(await fs.readdir(jobsDir)).filter(n=>n.endsWith(".json")).sort();

async function generate(prompt,aspectRatio,resolution,out){
 let operation=await ai.models.generateVideos({model,prompt,config:{aspectRatio,resolution,numberOfVideos:1}});
 while(!operation.done){await new Promise(r=>setTimeout(r,10000));operation=await ai.operations.getVideosOperation({operation});}
 const generated=operation.response?.generatedVideos?.[0]?.video;
 if(!generated)throw new Error("Veo returned no generated video");
 await ai.files.download({file:generated,downloadPath:out});
}

for(const name of names){
 const jobPath=path.join(jobsDir,name); const job=JSON.parse(await fs.readFile(jobPath,"utf8"));
 if(job.status!=="TODO"||!["VIDEO","VIDEO_SEQUENCE"].includes(job.type))continue;
 const id=job.id||path.basename(name,".json"), outputPath=path.join(resultsDir,`${id}.mp4`), statusPath=path.join(resultsDir,`${id}.json`);
 try{
  await fs.writeFile(statusPath,JSON.stringify({...job,status:"RUNNING",startedAt:new Date().toISOString()},null,2));
  const ar=job.aspectRatio||"16:9",res=job.resolution||"720p";
  if(job.type==="VIDEO_SEQUENCE"){
   const prompts=job.prompts||[]; if(!prompts.length)throw new Error("VIDEO_SEQUENCE requires prompts");
   const parts=[];
   for(let i=0;i<prompts.length;i++){const p=path.join(resultsDir,`.${id}-part-${String(i+1).padStart(2,"0")}.mp4`);await generate(prompts[i],ar,res,p);parts.push(p);}
   const list=path.join(resultsDir,`.${id}-concat.txt`);
   await fs.writeFile(list,parts.map(p=>`file '${path.resolve(p).replaceAll("'","'\\''")}'`).join("\n"));
   await execFileAsync("ffmpeg",["-y","-f","concat","-safe","0","-i",list,"-c","copy",outputPath]);
   await Promise.all([...parts,list].map(p=>fs.rm(p,{force:true})));
  }else await generate(job.prompt,ar,res,outputPath);
  await fs.writeFile(statusPath,JSON.stringify({...job,status:"DONE",finishedAt:new Date().toISOString(),artifact:outputPath,engine:model},null,2));
 }catch(error){await fs.writeFile(statusPath,JSON.stringify({...job,status:"ERROR",finishedAt:new Date().toISOString(),error:error instanceof Error?error.message:String(error)},null,2));process.exitCode=1;}
}