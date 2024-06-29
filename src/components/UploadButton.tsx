'use client'
import { useState } from "react";
import { Dialog, DialogContent, DialogTrigger } from "./ui/dialog";
import { Button } from "./ui/button";
import Dropzone from "react-dropzone";
import {Cloud, File, Loader2} from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { useRouter } from "next/navigation";
import { Progress } from "./ui/progress";
import { trpc } from "@/app/_trpc/client";

const UploadButton = ()=>{
    const [isOpen, setIsOpen] = useState<boolean>(false);

    return(
        <Dialog open={isOpen} onOpenChange={(v)=>{
            if(!v){
                setIsOpen(v);
            }
            }}> 

            <DialogTrigger onClick={()=>{
                setIsOpen(true)
            }} asChild>
                <Button size={"sm"}>Upload PDF</Button>
            </DialogTrigger>
            <DialogContent >
                <UploadDropZone />
            </DialogContent>
        </Dialog>
    )
}


const UploadDropZone = ()=>{
    const [isUploading, setIsUploading] = useState<boolean>(true);
    const [uploadProgress, setUploadProgress] = useState<number>(0);
    const { toast } = useToast();
    const router = useRouter();

    const {mutate: startPolling} = trpc.getFile.useMutation({
        onSuccess: (file)=>{
            router.push(`/dashboard/${file.id}`);
        },
        retry: true,
        retryDelay: 500
    })


    const startSimulatedProgress = () => {
        setUploadProgress(0)
    
        const interval = setInterval(() => {
          setUploadProgress((prevProgress) => {
            if (prevProgress >= 95) {
              clearInterval(interval)
              return prevProgress
            }
            return prevProgress + 5
          })
        }, 500)
    
        return interval
    }

    return(
        <Dropzone multiple={false} accept={{"application/pdf" : [".pdf"]}} onDrop={async(acceptedFiles)=>{
            const file = acceptedFiles[0];
            // check for other file type
            if(file.type !== "application/pdf"){
                return toast({
                    variant: "destructive",
                    title: "Uh oh! Something went wrong.",
                    description: "Only PDF allowed.",
                  })
            }
            // greater than 4 MB
            if(file.size > 16*1024*1024){
                return toast({
                    variant: "destructive",
                    title: "Uh oh! Something went wrong.",
                    description: "File is too large",
                  })
            }

            try{
                setIsUploading(true)
                const progressInterval = startSimulatedProgress()

                const fileData = new FormData();
                fileData.append('file', file);

                console.log("here 1");

                const response = await fetch("/api/s3/upload",{
                    method: "POST",
                    body: fileData,
                });                

                console.log("here 2 : ", response);

                if (!response.ok) {
                    console.log("here 3");
                    throw new Error("Failed to upload file.");
                }

                console.log("here 4");

                const fileInfo = await response.json();

                console.log("here 5");
                
                if (!fileInfo) {
                    console.log("here 6");
                    throw new Error("File info not received.");  
                }

                console.log("here 7");

                clearInterval(progressInterval)
                setUploadProgress(100)
                startPolling({ id: fileInfo.fileId });

                console.log("here 8");
            }catch(error){
                console.log("here 9");
                toast({
                    variant: "destructive",
                    title: "Upload failed",
                    description: "Could not upload file.",
                });
        
                setIsUploading(false);
                setUploadProgress(0);
            }
        }}>
            {({getRootProps, getInputProps, acceptedFiles})=>(
                <div {...getRootProps()} className='border h-64 m-4 border-dashed border-gray-300 rounded-lg'>
                    <div className='flex items-center justify-center h-full w-full'>
                    <label
                    htmlFor='dropzone-file'
                    className='flex flex-col items-center justify-center w-full h-full rounded-lg cursor-pointer bg-gray-50 hover:bg-gray-100'>
                        <div className='flex flex-col items-center justify-center pt-5 pb-6'>
                            <Cloud className='h-10 w-10 text-zinc-500 mb-2' />
                            <p className='mb-2 text-sm text-zinc-700'>
                                <span className='font-bold'>
                                    Click to upload
                                </span>{' '}
                                or drag and drop
                            </p>
                            <p className='text-xs text-zinc-500'>
                                PDF (up to 4 MB)
                            </p>
                        </div>

                        {acceptedFiles && acceptedFiles[0] ? (
                            <div className='max-w-xs bg-white flex items-center rounded-md overflow-hidden outline outline-[1px] outline-zinc-200 divide-x divide-zinc-200'>
                                <div className='px-3 py-2 h-full grid place-items-center'>
                                    <File className='h-6 w-6 text-blue-500' />
                                </div>
                                <div className='px-3 py-2 h-full text-sm truncate'>
                                    {acceptedFiles[0].name}
                                </div>
                            </div>
                        ):  null }

                        {isUploading ? (
                            <div className='w-[80%] mt-4 max-w-xs mx-auto'>
                            <Progress
                              indicatorColor={
                                uploadProgress === 100
                                  ? 'bg-green-500'
                                  : ''
                              }
                              value={uploadProgress}
                              className='h-1 w-full bg-zinc-200'
                            />
                            {uploadProgress === 100 ? (
                              <div className='flex gap-1 items-center justify-center text-sm text-zinc-700 text-center pt-2'>
                                <Loader2 className='h-3 w-3 animate-spin' />
                                Redirecting...
                              </div>
                            ) : null}
                          </div>
                        ): null}

                        <input {...getInputProps} type="file" id="dropzone-file" className="hidden" />
                    </label>
                    </div>
                </div>
            )}
        </Dropzone>
    )
}



export default UploadButton;