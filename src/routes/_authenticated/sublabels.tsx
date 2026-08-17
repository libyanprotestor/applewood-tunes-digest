import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  createSublabelUser,
  deleteSublabel,
  listSublabelUsers,
  listSublabels,
  resetSublabelPassword,
  saveSublabel,
} from "@/lib/admin.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_authenticated/sublabels")({
  head: () => ({
    meta: [
      { title: "Sublabels | Apple Music Sales Dashboard" },
      { name: "description", content: "Create sublabels, edit details and manage their dashboard logins." },
      { property: "og:title", content: "Sublabels | Apple Music Sales Dashboard" },
      {
        property: "og:description",
        content: "Create sublabels, edit details and manage their dashboard logins.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SublabelsPage,
});

const PAGE_SIZE = 8;

function randomPassword() {
  const chars = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%";
  const bytes = new Uint32Array(14);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

function SublabelsPage() {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [loginFor, setLoginFor] = useState<string | null>(null);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  const sublabels = useQuery({ queryKey: ["sublabels"], queryFn: useServerFn(listSublabels) });
  const users = useQuery({ queryKey: ["sublabel-users"], queryFn: useServerFn(listSublabelUsers) });
  const saveFn = useServerFn(saveSublabel);
  const deleteFn = useServerFn(deleteSublabel);
  const userFn = useServerFn(createSublabelUser);
  const resetFn = useServerFn(resetSublabelPassword);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["sublabels"] });
    void qc.invalidateQueries({ queryKey: ["sublabel-users"] });
  };

  const userBySublabel = useMemo(() => {
    const map = new Map<string, { id: string; email: string | null }>();
    for (const u of users.data ?? []) {
      if (u.sublabel_id) map.set(u.sublabel_id, { id: u.id, email: u.email });
    }
    return map;
  }, [users.data]);

  const rows = sublabels.data ?? [];
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const visible = rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const create = useMutation({
    mutationFn: () => saveFn({ data: { name, contactEmail, isActive: true } }),
    onSuccess: () => {
      setName("");
      setContactEmail("");
      invalidate();
      toast.success("Sublabel added");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const update = useMutation({
    mutationFn: (id: string) =>
      saveFn({ data: { id, name: editName, contactEmail: editEmail, isActive: true } }),
    onSuccess: () => {
      setEditing(null);
      invalidate();
      toast.success("Sublabel updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      invalidate();
      toast.success("Sublabel deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const issue = useMutation({
    mutationFn: () =>
      userFn({ data: { sublabelId: loginFor!, email: loginEmail, password: loginPassword } }),
    onSuccess: (res: { ok: boolean; message: string }) => {
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      setLoginFor(null);
      setLoginEmail("");
      setLoginPassword("");
      invalidate();
      toast.success("Login created");
    },

    onError: (e: Error) => toast.error(e.message),
  });

  const reset = useMutation({
    mutationFn: (vars: { userId: string; password: string }) =>
      resetFn({ data: vars }).then(() => vars.password),
    onSuccess: (password) =>
      toast.success("New password generated", {
        description: password,
        duration: 20000,
      }),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Sublabels</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Add and edit sublabels, and manage the email and password each one uses to sign in.
      </p>

      <form
        className="mt-8 grid grid-cols-[minmax(0,1fr)] items-end gap-3 rounded-2xl border border-border bg-card p-6 sm:flex sm:flex-wrap"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <div className="min-w-0 flex-1 space-y-2 sm:min-w-48">
          <Label htmlFor="name">Sublabel name</Label>
          <Input id="name" required value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="min-w-0 flex-1 space-y-2 sm:min-w-48">
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

      <div className="mt-8 rounded-2xl border border-border bg-card">
        <div className="max-h-[32rem] divide-y divide-border overflow-y-auto">
          {rows.length === 0 && <p className="p-6 text-sm text-muted-foreground">No sublabels yet.</p>}
          {visible.map((s) => {
            const login = userBySublabel.get(s.id);
            return (
              <div key={s.id} className="p-6">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{s.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {s.contact_email ?? "No contact email"}
                    </p>
                    <p className="mt-2 text-xs">
                      {login ? (
                        <span className="text-muted-foreground">
                          Login:{" "}
                          <span className="font-medium text-foreground">{login.email ?? "—"}</span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">No login issued yet</span>
                      )}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap justify-end gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setLoginFor(null);
                        setEditing(editing === s.id ? null : s.id);
                        setEditName(s.name);
                        setEditEmail(s.contact_email ?? "");
                      }}
                    >
                      Edit
                    </Button>
                    {login ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={reset.isPending}
                        onClick={() =>
                          reset.mutate({ userId: login.id, password: randomPassword() })
                        }
                      >
                        New password
                      </Button>
                    ) : (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setEditing(null);
                          setLoginFor(loginFor === s.id ? null : s.id);
                        }}
                      >
                        Issue login
                      </Button>
                    )}
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

                {editing === s.id && (
                  <form
                    className="mt-4 grid grid-cols-[minmax(0,1fr)] items-end gap-3 rounded-xl bg-secondary/40 p-4 sm:flex sm:flex-wrap"
                    onSubmit={(e) => {
                      e.preventDefault();
                      update.mutate(s.id);
                    }}
                  >
                    <div className="min-w-0 flex-1 space-y-2 sm:min-w-48">
                      <Label htmlFor={`edit-name-${s.id}`}>Name</Label>
                      <Input
                        id={`edit-name-${s.id}`}
                        required
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                      />
                    </div>
                    <div className="min-w-0 flex-1 space-y-2 sm:min-w-48">
                      <Label htmlFor={`edit-email-${s.id}`}>Contact email</Label>
                      <Input
                        id={`edit-email-${s.id}`}
                        type="email"
                        value={editEmail}
                        onChange={(e) => setEditEmail(e.target.value)}
                      />
                    </div>
                    <Button type="submit" disabled={update.isPending}>
                      Save changes
                    </Button>
                  </form>
                )}

                {loginFor === s.id && (
                  <form
                    className="mt-4 grid grid-cols-[minmax(0,1fr)] items-end gap-3 rounded-xl bg-secondary/40 p-4 sm:flex sm:flex-wrap"
                    onSubmit={(e) => {
                      e.preventDefault();
                      issue.mutate();
                    }}
                  >
                    <div className="min-w-0 flex-1 space-y-2 sm:min-w-48">
                      <Label htmlFor={`email-${s.id}`}>Login email</Label>
                      <Input
                        id={`email-${s.id}`}
                        type="email"
                        required
                        value={loginEmail}
                        onChange={(e) => setLoginEmail(e.target.value)}
                      />
                    </div>
                    <div className="min-w-0 flex-1 space-y-2 sm:min-w-48">
                      <Label htmlFor={`pw-${s.id}`}>Password</Label>
                      <div className="flex gap-2">
                        <Input
                          id={`pw-${s.id}`}
                          type="text"
                          required
                          minLength={8}
                          value={loginPassword}
                          onChange={(e) => setLoginPassword(e.target.value)}
                        />
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => setLoginPassword(randomPassword())}
                        >
                          Generate
                        </Button>
                      </div>
                    </div>
                    <Button type="submit" disabled={issue.isPending}>
                      Create login
                    </Button>
                  </form>
                )}
              </div>
            );
          })}
        </div>

        {rows.length > PAGE_SIZE && (
          <div className="flex items-center justify-between gap-3 border-t border-border p-4">
            <p className="text-xs text-muted-foreground">
              Page {currentPage} of {totalPages} · {rows.length} sublabels
            </p>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={currentPage <= 1}
                onClick={() => setPage(currentPage - 1)}
              >
                Previous
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={currentPage >= totalPages}
                onClick={() => setPage(currentPage + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
