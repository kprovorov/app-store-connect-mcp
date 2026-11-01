"use client";

import type { CreateConnectionRequest, KeyKind } from "@asc-mcp/contracts";
import { FileKeyIcon, PlusIcon, TriangleAlertIcon } from "lucide-react";
import { useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";

import { describeCreateError, type KeyField, type SubmitProblem } from "@/components/dashboard/key-errors";
import { KeyGuide } from "@/components/dashboard/key-guide";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useCreateConnection } from "@/hooks/use-connections";

type KeyForm = {
  name: string;
  keyKind: KeyKind;
  issuerId: string;
  keyId: string;
  privateKey: string;
  privateKeyFile: string | null;
  vendorNumber: string;
};

const emptyForm: KeyForm = {
  name: "",
  keyKind: "team",
  issuerId: "",
  keyId: "",
  privateKey: "",
  privateKeyFile: null,
  vendorNumber: "",
};

type FieldErrors = Partial<Record<KeyField, string>>;

function toRequest(form: KeyForm): { ok: true; request: CreateConnectionRequest } | { ok: false; errors: FieldErrors } {
  const name = form.name.trim();
  const issuerId = form.issuerId.trim();
  const keyId = form.keyId.trim();
  const privateKey = form.privateKey.trim();
  const vendorNumber = form.vendorNumber.trim();

  const errors: FieldErrors = {};
  if (!name) errors.name = "Give the key a name.";
  if (form.keyKind === "team" && !issuerId) errors.issuerId = "Team keys need the issuer ID.";
  if (!keyId) errors.keyId = "Enter the key ID.";
  if (!privateKey) errors.privateKey = "Upload the .p8 file or paste its contents.";
  else if (!privateKey.includes("BEGIN PRIVATE KEY")) errors.privateKey = "This doesn't look like a .p8 private key.";
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    request: {
      name,
      keyKind: form.keyKind,
      keyId,
      privateKey,
      ...(form.keyKind === "team" ? { issuerId } : {}),
      ...(vendorNumber ? { vendorNumber } : {}),
    },
  };
}

// Apple names the download `AuthKey_<KEY ID>.p8`.
const keyIdFromFileName = (fileName: string) => /^AuthKey_([A-Z0-9]+)\.p8$/i.exec(fileName)?.[1]?.toUpperCase();

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {error}
        </p>
      ) : (
        hint && <p className="text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

export function AddKeyDialog({ trigger }: { trigger?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<KeyForm>(emptyForm);
  const [pasting, setPasting] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [problem, setProblem] = useState<Extract<SubmitProblem, { kind: "alert" }> | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const create = useCreateConnection();
  const id = useId();

  const clearError = (field: KeyField) =>
    setErrors((current) => {
      const next = { ...current };
      delete next[field];
      return next;
    });

  const set = <K extends keyof KeyForm & KeyField>(key: K, value: KeyForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    clearError(key);
  };

  const clearPrivateKey = () => {
    setForm((current) => ({ ...current, privateKey: "", privateKeyFile: null }));
    if (fileInput.current) fileInput.current.value = "";
  };

  const reset = () => {
    setForm(emptyForm);
    setPasting(false);
    setErrors({});
    setProblem(null);
    create.reset();
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const contents = await file.text();
    const keyId = keyIdFromFileName(file.name);
    setForm((current) => ({
      ...current,
      privateKey: contents,
      privateKeyFile: file.name,
      keyId: current.keyId || keyId || "",
    }));
    clearError("privateKey");
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setProblem(null);
    const parsed = toRequest(form);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    setErrors({});
    clearPrivateKey();
    create.mutate(parsed.request, {
      onSuccess: (connection) => {
        toast.success(`Added “${connection.name}”`, { description: "Apple accepted the key." });
        setOpen(false);
        reset();
      },
      onError: (error) => {
        const described = describeCreateError(error);
        if (described.kind === "field") setErrors({ [described.field]: described.message });
        else setProblem(described);
        create.reset();
      },
    });
  };

  const fieldId = (field: KeyField) => `${id}-${field}`;
  const invalid = (field: KeyField) =>
    errors[field] ? { "aria-invalid": true, "aria-describedby": `${fieldId(field)}-error` } : {};

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <PlusIcon data-icon="inline-start" />
            Add key
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add an App Store Connect key</DialogTitle>
          <DialogDescription>
            We check the key with Apple before saving it, then store it encrypted. Nobody can view it again.
          </DialogDescription>
        </DialogHeader>

        <KeyGuide />

        <form id={`${id}-form`} onSubmit={onSubmit} className="grid gap-4" noValidate>
          {problem && (
            <Alert variant="destructive">
              <TriangleAlertIcon />
              <AlertTitle>{problem.title}</AlertTitle>
              <AlertDescription>{problem.description}</AlertDescription>
            </Alert>
          )}

          <Field id={fieldId("name")} label="Name" hint="Only you and your team see this." error={errors.name}>
            <Input
              id={fieldId("name")}
              placeholder="Pocket Ledger, App Manager"
              value={form.name}
              onChange={(event) => set("name", event.target.value)}
              {...invalid("name")}
            />
          </Field>

          <div className="grid gap-1.5">
            <Label id={`${id}-kind`}>Key type</Label>
            <Tabs value={form.keyKind} onValueChange={(value) => setForm((current) => ({ ...current, keyKind: value === "individual" ? "individual" : "team" }))}>
              <TabsList aria-labelledby={`${id}-kind`} className="w-full">
                <TabsTrigger value="team">Team key (recommended)</TabsTrigger>
                <TabsTrigger value="individual">Individual key</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {form.keyKind === "team" && (
            <Field
              id={fieldId("issuerId")}
              label="Issuer ID"
              hint="Shown at the top of the Integrations page."
              error={errors.issuerId}
            >
              <Input
                id={fieldId("issuerId")}
                className="font-mono"
                placeholder="57246542-96fe-1a63-e053-0824d011072a"
                autoComplete="off"
                spellCheck={false}
                value={form.issuerId}
                onChange={(event) => set("issuerId", event.target.value)}
                {...invalid("issuerId")}
              />
            </Field>
          )}

          <Field id={fieldId("keyId")} label="Key ID" error={errors.keyId}>
            <Input
              id={fieldId("keyId")}
              className="font-mono"
              placeholder="2X9R4HXF34"
              autoComplete="off"
              spellCheck={false}
              value={form.keyId}
              onChange={(event) => set("keyId", event.target.value)}
              {...invalid("keyId")}
            />
          </Field>

          <Field id={fieldId("privateKey")} label="Private key" error={errors.privateKey}>
            <input
              ref={fileInput}
              type="file"
              accept=".p8"
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              onChange={(event) => void onFile(event.target.files?.[0])}
            />
            {form.privateKeyFile ? (
              <div className="flex items-center gap-2 rounded-lg border px-3 py-2">
                <FileKeyIcon className="size-4 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate font-mono text-sm">{form.privateKeyFile}</span>
                <Button type="button" variant="ghost" size="sm" onClick={clearPrivateKey}>
                  Remove
                </Button>
              </div>
            ) : pasting ? (
              <>
                <Textarea
                  id={fieldId("privateKey")}
                  className="min-h-28 font-mono text-xs"
                  placeholder={"-----BEGIN PRIVATE KEY-----\n…\n-----END PRIVATE KEY-----"}
                  autoComplete="off"
                  spellCheck={false}
                  value={form.privateKey}
                  onChange={(event) => set("privateKey", event.target.value)}
                  {...invalid("privateKey")}
                />
                <Button
                  type="button"
                  variant="link"
                  className="h-auto w-fit p-0 text-xs"
                  onClick={() => {
                    setPasting(false);
                    clearPrivateKey();
                  }}
                >
                  Upload the .p8 file instead
                </Button>
              </>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  id={fieldId("privateKey")}
                  type="button"
                  variant="outline"
                  onClick={() => fileInput.current?.click()}
                  {...invalid("privateKey")}
                >
                  <FileKeyIcon data-icon="inline-start" />
                  Choose .p8 file
                </Button>
                <Button type="button" variant="link" className="h-auto p-0 text-xs" onClick={() => setPasting(true)}>
                  Paste it instead
                </Button>
              </div>
            )}
          </Field>

          <Field
            id={fieldId("vendorNumber")}
            label={
              <>
                Vendor number <span className="font-normal text-muted-foreground">(optional)</span>
              </>
            }
            hint="Needed only for sales and finance reports."
            error={errors.vendorNumber}
          >
            <Input
              id={fieldId("vendorNumber")}
              className="font-mono"
              placeholder="85012345"
              inputMode="numeric"
              autoComplete="off"
              value={form.vendorNumber}
              onChange={(event) => set("vendorNumber", event.target.value)}
              {...invalid("vendorNumber")}
            />
          </Field>
        </form>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </DialogClose>
          <Button type="submit" form={`${id}-form`} disabled={create.isPending}>
            {create.isPending ? "Checking with Apple…" : "Add key"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
