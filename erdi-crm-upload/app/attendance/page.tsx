import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { redirect } from "next/navigation";
import { AttendanceList } from "./AttendanceList";
import { db } from "@/lib/db";

export default async function AttendancePage() {
  const session = await getServerSession(authOptions);
  if (!session) {
    redirect("/login");
  }

  const user = await db.user.findUnique({
    where: { email: session.user?.email || "" }
  });

  const isAdmin = user && ["SUPER_ADMIN", "ADMIN"].includes(user.role);

  // Fetch customers for Business Trip linking
  const companies = await db.company.findMany({
    select: { id: true, name: true }
  });

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Leave & Business Trips (行政考勤)</h1>
      </div>
      <AttendanceList isAdmin={!!isAdmin} companies={companies} />
    </div>
  );
}
