import { db } from "@/db";
import { openai } from "@/lib/openai";
// import { pinecone } from "@/lib/pinecone";
import { SendMessageValidator } from "@/lib/validators/SendMessageValidator";
import { getKindeServerSession } from "@kinde-oss/kinde-auth-nextjs/server";
import { OpenAIEmbeddings } from "@langchain/openai";
// import { PineconeStore } from "@langchain/pinecone";
import { NextRequest } from "next/server";
import { OpenAIStream, StreamingTextResponse } from 'ai'
import { createClient } from '@supabase/supabase-js'
import { SupabaseVectorStore, SupabaseFilterRPCCall } from "@langchain/community/vectorstores/supabase";
// import { SupabaseFilterRPCCall, SupabaseVectorStore } from 'langchain/vectorstores/supabase'

export const POST = async (req : NextRequest)=>{
    const body = await req.json();

    // checking if the user exists
    const {getUser} = await getKindeServerSession();
    const user = await getUser();
    const userId = user?.id;
    if(!userId){
        return new Response('Unauthorised', {status: 401})
    }

    // checking if the body matches the requirements, else it will throw error
    const {fileId, message} = SendMessageValidator.parse(body);

    // checking if the file exists
    const file = await db.file.findFirst({
        where:{
            id: fileId,
            userId
        }
    })
    if(!file){
        return new Response('Not found', {status: 404});
    }

    // creating message in the database
    await db.message.create({
        data:{
            text : message,
            isUserMessage: true,
            userId,
            fileId
        }
    })

    // vectorizing the message for OpenAI
    const embeddings = new OpenAIEmbeddings({
        openAIApiKey: process.env.OPENAI_API_KEY
    })

    // PINECONE IMPLEMENTATION

    // const pineconeIndex = pinecone.Index(`${process.env.PINECONE_INDEX}`);
    // const vectorStore = await PineconeStore.fromExistingIndex(embeddings,{
    //     pineconeIndex,
    //     namespace: file.id
    // })
    // const results = await vectorStore.similaritySearch(message, 4);

    // SUPABASE IMPLEMENTATION  

    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!supabaseKey) throw new Error(`Expected SUPABASE_SERVICE_ROLE_KEY`)
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    if (!url) throw new Error(`Expected env var SUPABASE_URL`)
    const client = createClient(url, supabaseKey);

    const vectorStore = await SupabaseVectorStore.fromExistingIndex(
        new OpenAIEmbeddings(), 
        {
            client,
            tableName: "documents",
            queryName: "match_documents"
        }
    );

    // console.log("vector store - ", vectorStore); 
    const results = await vectorStore.similaritySearch(message, 4);  
    // console.log("results - ", results);

    // retrieving previous messages and formatting them in a particular format for OpenAI
    const prevMessages = await db.message.findMany({
        where:{
            fileId
        },
        orderBy:{
            createdAt: "asc"
        },
        take: 10
    })
    const formattedPrevMessages = prevMessages.map((msg)=>({
        role: msg.isUserMessage ? "user" as const : "assistant" as const,
        content : msg.text
    }))

    // generating responses using OpenAI
    // here, we use a custom promt to let GPT know of the previous conversation, context, etc.
    const response = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        temperature: 0.9,
        stream: true,
        messages: [
          {
            role: 'system',
            content:
              'Use the following pieces of context (or previous conversaton if needed) to answer the users question in markdown format.',
          },
          {
            role: 'user',
            content: `Use the following pieces of context (or previous conversaton if needed) to answer the users question in markdown format. \nIf you don't know the answer, just say that you don't know, don't try to make up an answer.
            
            \n----------------\n
            
            PREVIOUS CONVERSATION:
            ${formattedPrevMessages.map((message) => {
                if (message.role === 'user')
                return `User: ${message.content}\n`
                return `Assistant: ${message.content}\n`
            })}
            
            \n----------------\n
            
            CONTEXT:
            ${results.map((r) => r.pageContent).join('\n\n')}
            
            USER INPUT: ${message}`,
          },
        ],
    })

    const stream = OpenAIStream(response, {
        async onCompletion(completion) {
          await db.message.create({
            data: {
              text: completion,
              isUserMessage: false,
              fileId,
              userId,
            },
          })
        },
    })
    
    return new StreamingTextResponse(stream)

}   