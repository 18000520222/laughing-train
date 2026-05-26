"use client";

import { useState, useEffect } from "react";
import { format } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/Badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { Check, X, FileText, Loader2, Plus } from "lucide-react";

export function ExpenseList({ isAdmin, opportunities }: { isAdmin: boolean, opportunities: any[] }) {
  const [expenses, setExpenses] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const { toast } = useToast();

  // Form state
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("CNY");
  const [category, setCategory] = useState("Logistics");
  const [description, setDescription] = useState("");
  const [opportunityId, setOpportunityId] = useState("none");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    fetchExpenses();
  }, []);

  const fetchExpenses = async () => {
    try {
      const res = await fetch("/api/expenses");
      const data = await res.json();
      setExpenses(data);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          amount,
          currency,
          category,
          description,
          opportunityId: opportunityId === "none" ? undefined : opportunityId
        })
      });

      if (!res.ok) throw new Error("Failed to submit expense");
      
      toast({ title: "Success", description: "Expense claim submitted." });
      setIsDialogOpen(false);
      fetchExpenses();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStatusUpdate = async (id: string, newStatus: string) => {
    try {
      const res = await fetch(`/api/expenses/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus })
      });
      if (!res.ok) throw new Error("Update failed");
      toast({ title: "Status Updated" });
      fetchExpenses();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const statusColors: any = {
    PENDING: "bg-yellow-100 text-yellow-800",
    APPROVED: "bg-blue-100 text-blue-800",
    PAID: "bg-green-100 text-green-800",
    REJECTED: "bg-red-100 text-red-800"
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4 mr-2" /> New Expense Claim</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Submit Expense Claim (提交报账)</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label>Title (标题)</Label>
                <Input required value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. DHL sample shipping" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Amount (金额)</Label>
                  <Input type="number" step="0.01" required value={amount} onChange={e => setAmount(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Currency (币种)</Label>
                  <Select value={currency} onValueChange={setCurrency}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="CNY">CNY</SelectItem>
                      <SelectItem value="USD">USD</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Category (类别)</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Logistics">Logistics (物流费)</SelectItem>
                    <SelectItem value="Procurement">Procurement (采购费)</SelectItem>
                    <SelectItem value="Travel">Travel (差旅费)</SelectItem>
                    <SelectItem value="Other">Other (其他)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Link to Opportunity (关联商机 - Optional)</Label>
                <Select value={opportunityId} onValueChange={setOpportunityId}>
                  <SelectTrigger><SelectValue placeholder="Select Opportunity" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">-- None --</SelectItem>
                    {opportunities.map(opp => (
                      <SelectItem key={opp.id} value={opp.id}>
                        {opp.opportunityCode || opp.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Description (详细描述 - Optional)</Label>
                <Input value={description} onChange={e => setDescription(e.target.value)} />
              </div>
              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : "Submit Claim"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Submitted By</TableHead>
                <TableHead>Status</TableHead>
                {isAdmin && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8">Loading...</TableCell></TableRow>
              ) : expenses.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8">No expenses found.</TableCell></TableRow>
              ) : (
                expenses.map(exp => (
                  <TableRow key={exp.id}>
                    <TableCell>{format(new Date(exp.createdAt), "yyyy-MM-dd")}</TableCell>
                    <TableCell>
                      <div className="font-medium">{exp.title}</div>
                      {exp.opportunity && <div className="text-xs text-muted-foreground mt-1">Opp: {exp.opportunity.title}</div>}
                    </TableCell>
                    <TableCell>{exp.category}</TableCell>
                    <TableCell className="font-medium">{exp.currency} {exp.amount.toFixed(2)}</TableCell>
                    <TableCell>{exp.submittedBy.name}</TableCell>
                    <TableCell>
                      <span className={`px-2 py-1 rounded-full text-xs font-semibold ${statusColors[exp.status]}`}>
                        {exp.status}
                      </span>
                    </TableCell>
                    {isAdmin && (
                      <TableCell className="text-right space-x-2">
                        {exp.status === 'PENDING' && (
                          <>
                            <Button size="sm" variant="outline" className="text-green-600 border-green-200" onClick={() => handleStatusUpdate(exp.id, 'APPROVED')}>
                              <Check className="w-4 h-4" />
                            </Button>
                            <Button size="sm" variant="outline" className="text-red-600 border-red-200" onClick={() => handleStatusUpdate(exp.id, 'REJECTED')}>
                              <X className="w-4 h-4" />
                            </Button>
                          </>
                        )}
                        {exp.status === 'APPROVED' && (
                          <Button size="sm" variant="outline" className="text-blue-600 border-blue-200" onClick={() => handleStatusUpdate(exp.id, 'PAID')}>
                            Mark Paid
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
