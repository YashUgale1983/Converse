import { uploadToS3} from '@/lib/s3';
// import { uploadToS3, getS3Url} from '@/lib/s3';
import { NextResponse } from 'next/server';


export const POST = async (req: Request)=>{
    const fileRes = await req.formData();
    const file: File | null = fileRes.get('file') as unknown as File;
    if (!file) {
        return NextResponse.json({ success: false })
    }
   const data = await uploadToS3(file);
   return NextResponse.json(data);
}

