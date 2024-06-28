import { getKindeServerSession } from "@kinde-oss/kinde-auth-nextjs/server";
import AWS from "aws-sdk";
import { db } from "@/db"; 
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { OpenAIEmbeddings } from "@langchain/openai";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { TRPCError } from "@trpc/server";
import { createClient } from '@supabase/supabase-js'
import { SupabaseVectorStore } from "@langchain/community/vectorstores/supabase";
import { getUserSubscriptionPlan } from "./stripe";
import { PLANS } from "@/config/stripe";

export const uploadToS3 = async (file: File)=>{
    try{
        // getting the user details
        const {getUser} = getKindeServerSession();
        const user = await getUser();
        if(!user || !user.id){
            throw new TRPCError({code: "UNAUTHORIZED"});
        }

        const isSubscribed = (await getUserSubscriptionPlan()).isSubscribed
        
        if(file.size > 1*1024*1024 && !isSubscribed){
            // not alllowed to proceed further
            throw new Error("File size exceeds limit for free users.");
        }

        if(file.size > 16*1024*1024 && isSubscribed){
            // more than 16 mb not allowed
            throw new Error("File size exceeds 16MB limit for pro users.");
        }

        // configuring AWS S3 bucket
        AWS.config.update({
            accessKeyId: process.env.NEXT_PUBLIC_AWS_S3_ACCESS_KEY_ID,
            secretAccessKey: process.env.NEXT_PUBLIC_AWS_S3_SECRET_ACCESS_KEY
        })
        const s3 = new AWS.S3({
            params:{
                Bucket: process.env.NEXT_PUBLIC_AWS_S3_BUCKET_NAME,
            },
            region: "ap-south-1"
        })

        // converting uploaded file to buffer form to put it in S3 
        const bytes = await file.arrayBuffer()
        const buffer = Buffer.from(bytes)
        const file_key = 'uploads/' + user.id + "-" + Date.now().toString() + "-" + file.name.replace(" ", "-");
        
        // setting parameters and uploading to S3 bucket
        const params = {
            Bucket: process.env.NEXT_PUBLIC_AWS_S3_BUCKET_NAME!,
            Key : file_key,
            Body : buffer
        }
        const upload = await s3.putObject(params).promise()
        
        // creating file in our database
        const createdFile = await db.file.create({
            data:{
                key: file_key,
                name: file.name,
                userId : user.id,
                url : `https://${process.env.NEXT_PUBLIC_AWS_S3_BUCKET_NAME}.s3.ap-south-1.amazonaws.com/${file_key}`,
                uploadStatus: "PROCESSING",
            }
        })
        
        try{
            // fetching file from S3 bucket and converting to required format for indexing and vectorizing
            const response = await fetch(`${createdFile.url}`);
            const blob = await response.blob();
            const loader = new PDFLoader(blob);
            const pageLevelDocs = await loader.load();
            const pagesAmt = pageLevelDocs.length;

            let isProExceeded = false
            let isFreeExceeded = false
            if(pagesAmt > PLANS.find((plan) => plan.name === 'Pro')!.pagesPerPdf){
                isProExceeded = true
            }
            if(pagesAmt > PLANS.find((plan) => plan.name === 'Free')!.pagesPerPdf){
                isFreeExceeded = true
            }
            
            if ((isSubscribed && isProExceeded) || (!isSubscribed && isFreeExceeded)) {
                throw new Error("Page limit exceeded or subscription required. Upload failed.");
            }
            
            const embeddings = new OpenAIEmbeddings({
                openAIApiKey: process.env.OPENAI_API_KEY!
            });

            // PINECONE IMPLEMENTATION

            // const pineconeIndex = pc.index(process.env.PINECONE_INDEX!);
            // await PineconeStore.fromDocuments(
            //     pageLevelDocs,
            //     embeddings,
            //     {
            //     //@ts-ignore
            //       pineconeIndex,
            //       namespace: createdFile.id,
            //     }
            //   )


            // SUPABASE IMPLEMENTATION

            const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
            if (!supabaseKey) throw new Error(`Expected SUPABASE_SERVICE_ROLE_KEY`)

            const url = process.env.NEXT_PUBLIC_SUPABASE_URL
            if (!url) throw new Error(`Expected env var SUPABASE_URL`)

            const client = createClient(url, supabaseKey);
              
            const vectorStore = await SupabaseVectorStore.fromDocuments(
                pageLevelDocs,
                embeddings,
                {
                    client,
                    tableName: "documents",
                    queryName: "match_documents",
                }
            );  

            // updating file upload status to SUCCESS
            await db.file.update({
                data:{
                    uploadStatus: "SUCCESS"
                },
                where:{
                    id: createdFile.id
                }
            })
        }catch(err){
            // updating file upload status to FAILED if any error
            await db.file.update({
                data:{
                    uploadStatus: "FAILED"
                },
                where:{
                    id: createdFile.id
                }
            })
        }

        return Promise.resolve({
            fileId : createdFile.id,
            file_key,
            file_name: file.name
        })
    }catch(err){
        return new Error("Could not upload to S3. Try again...")
    }
} 