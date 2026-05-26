import { db } from "@/lib/db";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { NextResponse } from "next/server";

export async function PATCH(
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

    if (!user || !["SUPER_ADMIN", "ADMIN", "FINANCE"].includes(user.role)) {
      return NextResponse.json({ error: "Forbidden: Not an admin/finance" }, { status: 403 });
    }

    const { status } = await req.json();

    const expense = await db.expenseClaim.update({
      where: { id: params.id },
      data: {
        status,
        approvedById: user.id
      }
    });

    return NextResponse.json(expense);
  } catch (error) {
    console.error("Error updating expense:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
