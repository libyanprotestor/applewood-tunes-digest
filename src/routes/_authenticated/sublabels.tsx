import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  createSublabelUser,
  deleteSublabel,
  listSublabels,
  saveSublabel,
} from "@/lib/admin.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_authenticated/sublabels")({
  head: () => ({
    meta: [
      { title: "Sublabels | Apple Music Sales Dashboard" },
      { name: "description", content: "Create sublabels and issue their dashboard logins." },
      { property: "og:title", content: "Sublabels | Apple Music Sales Dashboard" },
      { property: "og:description", content: "Create sublabels and issue their dashboard logins." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SublabelsPage,
});

function SublabelsPage() {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [loginFor, setLoginFor] = useState<string | null>(null);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  const sublabels = useQuery({ queryKey: ["sublabels"], queryFn: useServerFn(listSublabels) });
  const saveFn = useServerFn(saveSublabel);
  const deleteFn = useServerFn(deleteSublabel);
  const userFn = useServerFn(createSublabelUser);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["sublabels"] });

  const create = useMutation({
    mutationFn: () => saveFn({ data: { name, contactEmail, isActive: true } }),
    onSuccess: () => {
      setName("");
      setContactEmail("");
      void invalidate();
      toast.success("Sublabel added");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      void invalidate();
      toast.success("Sublabel deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const issue = useMutation({
    mutationFn: () =>
      userFn({ data: { sublabelId: loginFor!, email: loginEmail, password: loginPassword } }),
    onSuccess: () => {
      setLoginFor(null);
      setLoginEmail("");
      setLoginPassword("");
      toast.success("Login created");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Sublabels</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Add sublabels manually, then issue each one an email and password for their own dashboard.
      </p>

      <form
        className="mt-8 flex flex-wrap items-end gap-3 rounded-2xl border border-border bg-card p-6"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <div className="min-w-48 flex-1 space-y-2">
          <Label htmlFor="name">Sublabel name</Label>
          <Input id="name" required value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="min-w-48 flex-1 space-y-2">
          <Label htmlFor="contact">Contact email (optional)</Label>
          <Input
            id="contact"
            type="email"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
          />
        </div>
        <Button type="submit" disabled={create.isPending}>
          Add sublabel
        </Button>
      </form>

      <div className="mt-8 divide-y divide-border rounded-2xl border border-border bg-card">
        {(sublabels.data ?? []).length === 0 && (
          <p className="p-6 text-sm text-muted-foreground">No sublabels yet.</p>
        )}
        {(sublabels.data ?? []).map((s) => (
          <div key={s.id} className="p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-medium">{s.name}</p>
                <p className="text-xs text-muted-foreground">{s.contact_email ?? "No contact email"}</p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setLoginFor(loginFor === s.id ? null : s.id)}
                >
                  Issue login
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => remove.mutate(s.id)}
                  disabled={remove.isPending}
                >
                  Delete
                </Button>
              </div>
            </div>

            {loginFor === s.id && (
              <form
                className="mt-4 flex flex-wrap items-end gap-3 rounded-xl bg-secondary/40 p-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  issue.mutate();
                }}
              >
                <div className="min-w-48 flex-1 space-y-2">
                  <Label htmlFor={`email-${s.id}`}>Login email</Label>
                  <Input
                    id={`email-${s.id}`}
                    type="email"
                    required
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                  />
                </div>
                <div className="min-w-48 flex-1 space-y-2">
                  <Label htmlFor={`pw-${s.id}`}>Password</Label>
                  <Input
                    id={`pw-${s.id}`}
                    type="text"
                    required
                    minLength={8}
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                  />
                </div>
                <Button type="submit" disabled={issue.isPending}>
                  Create login
                </Button>
              </form>
            )}
          </div>
        ))}
      </div>
    </main>
  );
}
