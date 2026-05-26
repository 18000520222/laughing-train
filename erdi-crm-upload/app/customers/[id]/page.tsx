import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { format } from "date-fns";
import { Building2, Globe, Mail, MapPin, Phone, User as UserIcon } from "lucide-react";
import { FollowUpList } from "./FollowUpList";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";

export default async function CustomerDetailPage({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return notFound();

  const company = await db.company.findUnique({
    where: { id: params.id },
    include: {
      contacts: true,
      opportunities: true,
      followUps: {
        include: {
          user: true,
        },
        orderBy: {
          createdAt: "desc"
        }
      }
    }
  });

  if (!company) {
    notFound();
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">{company.name}</h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="space-y-6 md:col-span-1">
          {/* Company Info */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="w-5 h-5" />
                Customer Info
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {company.website && (
                <div className="flex items-center gap-2 text-sm">
                  <Globe className="w-4 h-4 text-muted-foreground" />
                  <a href={company.website.startsWith('http') ? company.website : `https://${company.website}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                    {company.website}
                  </a>
                </div>
              )}
              {company.address && (
                <div className="flex items-center gap-2 text-sm">
                  <MapPin className="w-4 h-4 text-muted-foreground" />
                  <span>{company.address}</span>
                </div>
              )}
              <div className="text-sm">
                <span className="font-semibold text-muted-foreground block mb-1">Status</span>
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                  {company.status}
                </span>
              </div>
              {company.notes && (
                <div className="text-sm mt-4 pt-4 border-t">
                  <span className="font-semibold text-muted-foreground block mb-1">Notes</span>
                  <p className="whitespace-pre-wrap">{company.notes}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Contacts */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserIcon className="w-5 h-5" />
                Contacts
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {company.contacts.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No contacts added</p>
              ) : (
                company.contacts.map(contact => (
                  <div key={contact.id} className="p-3 border rounded-lg space-y-2">
                    <div className="font-medium">{contact.name}</div>
                    {contact.email && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Mail className="w-4 h-4" />
                        <a href={`mailto:${contact.email}`} className="hover:text-foreground">{contact.email}</a>
                      </div>
                    )}
                    {contact.phone && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Phone className="w-4 h-4" />
                        <a href={`tel:${contact.phone}`} className="hover:text-foreground">{contact.phone}</a>
                      </div>
                    )}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        <div className="md:col-span-2 space-y-6">
          <Card className="h-full">
            <CardHeader>
              <CardTitle>Communication Timeline</CardTitle>
            </CardHeader>
            <CardContent>
              <FollowUpList companyId={company.id} initialFollowUps={company.followUps} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
