import { db } from "@/lib/db";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { NextResponse } from "next/server";

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await db.user.findUnique({
      where: { email: session.user.email }
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const { content, type } = await req.json();

    if (!content) {
      return NextResponse.json({ error: "Content is required" }, { status: 400 });
    }

    const followUp = await db.followUp.create({
      data: {
        content,
        type: type || "NOTE",
        companyId: params.id,
        userId: user.id
      },
      include: {
        user: true
      }
    });

    return NextResponse.json(followUp);
  } catch (error) {
    console.error("Error creating follow-up:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
