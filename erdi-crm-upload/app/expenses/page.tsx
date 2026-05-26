import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { redirect } from "next/navigation";
import { ExpenseList } from "./ExpenseList";
import { db } from "@/lib/db";

export default async function ExpensesPage() {
  const session = await getServerSession(authOptions);
  if (!session) {
    redirect("/login");
  }

  const user = await db.user.findUnique({
    where: { email: session.user?.email || "" }
  });

  const isAdmin = user && ["SUPER_ADMIN", "ADMIN", "FINANCE"].includes(user.role);

  // Fetch opportunities to link expenses
  const opportunities = await db.opportunity.findMany({
    where: isAdmin ? {} : { ownerId: user?.id },
    select: { id: true, title: true, opportunityCode: true }
  });

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Expense & Approvals (报账审批)</h1>
      </div>
      <ExpenseList isAdmin={!!isAdmin} opportunities={opportunities} />
    </div>
  );
