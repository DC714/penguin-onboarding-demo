"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Accordion, Alert, Badge, Box, Button, Card, Code, Container, Group, List, Loader, Paper, ScrollArea,
  SimpleGrid, Stack, Table, Tabs, Text, ThemeIcon, Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconAlertTriangle, IconCheck, IconDatabase, IconFileImport, IconGitMerge, IconPlayerPlay, IconRefresh,
  IconShieldCheck, IconStethoscope, IconX, IconHelp, IconUserCheck,
} from "@tabler/icons-react";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;
type State = {
  runs: Row[]; issues: Row[]; members: Row[]; links: Row[]; providers: Row[]; requests: Row[]; decisions: Row[];
  policy: { id: string; title: string; criteria: { id: string; label: string }[] };
  sources: { fhir: string; hl7: string; csv: string };
};

const STEPS = [
  { key: "ingest", tab: "sources", label: "Ingest", icon: IconFileImport },
  { key: "validate", tab: "validate", label: "Validate", icon: IconShieldCheck },
  { key: "resolve", tab: "resolve", label: "Resolve", icon: IconGitMerge },
  { key: "authorize", tab: "auth", label: "Prior auth", icon: IconStethoscope },
] as const;

const OUTCOME = {
  AUTO_APPROVE: { color: "teal", label: "Auto-approved" },
  HUMAN_REVIEW: { color: "yellow", label: "Clinical review" },
  REQUEST_INFO: { color: "gwen", label: "Info requested" },
} as const;

async function call(step: string) {
  const res = await fetch("/api/pipeline", { method: "POST", body: JSON.stringify({ step }) });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "request failed");
  return json.stats as Record<string, number>;
}

export function Demo() {
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<string | null>("sources");

  const refresh = useCallback(async () => {
    setState(await (await fetch("/api/state", { cache: "no-store" })).json());
  }, []);
  useEffect(() => {
    fetch("/api/state", { cache: "no-store" }).then((r) => r.json()).then(setState);
  }, []);

  const run = async (steps: string[], goto?: string) => {
    try {
      for (const s of steps) {
        setBusy(s);
        const stats = await call(s);
        notifications.show({ title: s === "fix" ? "Provider directory fix applied" : `${s[0].toUpperCase()}${s.slice(1)} complete`, message: Object.entries(stats).map(([k, v]) => `${k}: ${v}`).join(" · "), color: "gwen" });
      }
      await refresh();
      if (goto) setTab(goto);
    } catch (e) {
      notifications.show({ title: "Step failed", message: String(e), color: "red" });
    } finally {
      setBusy(null);
    }
  };

  const ran = new Set((state?.runs ?? []).map((r) => r.step));
  const stats = (k: string) => state?.runs.find((r) => r.step === k)?.stats as Record<string, number> | undefined;

  return (
    <>
      <Box bg="#1a1a1a" c="white" py="xl" style={{ borderBottom: "4px solid #fe017d" }}>
        <Container size="xl">
          <Group justify="space-between" align="flex-end" wrap="wrap">
            <Stack gap={6}>
              <Text tt="uppercase" fz="xs" fw={600} c="#76b3b8" style={{ letterSpacing: 2, fontFamily: "var(--font-outfit)" }}>
                Forward deployed engineering demo · synthetic data
              </Text>
              <Title order={1} fz={{ base: 28, sm: 38 }} c="white">Onboarding a payer onto GwenOS</Title>
              <Text c="#b5c0c7" maw={680}>
                Northwind Health Plan (fictional) sends messy eligibility, provider, and claims data. Watch it get validated,
                de-duplicated, and used to decide prior authorizations with a full audit trail.
              </Text>
            </Stack>
            <Group>
              <Button variant="default" leftSection={<IconRefresh size={16} />} disabled={!!busy} onClick={() => run(["ingest"], "sources")}>
                Reset
              </Button>
              <Button size="md" leftSection={<IconPlayerPlay size={18} />} loading={!!busy} onClick={() => run(["ingest", "validate", "resolve", "authorize"], "auth")}>
                Run full pipeline
              </Button>
            </Group>
          </Group>
        </Container>
      </Box>

      <Container size="xl" py="lg">
        {!state ? (
          <Group justify="center" py={80}><Loader color="gwen" /><Text c="dimmed">Waking up the database…</Text></Group>
        ) : (
          <Stack gap="lg">
            <SimpleGrid cols={{ base: 2, md: 4 }}>
              {STEPS.map((s, i) => {
                const done = ran.has(s.key);
                const st = stats(s.key);
                return (
                  <Card key={s.key} padding="md" style={{ borderColor: done ? "#05526d" : undefined, cursor: "pointer" }} onClick={() => setTab(s.tab)}>
                    <Group gap="sm" mb={6}>
                      <ThemeIcon variant={done ? "filled" : "light"} color={done ? "deep" : "gray"} radius="xl">
                        {done ? <IconCheck size={16} /> : <s.icon size={16} />}
                      </ThemeIcon>
                      <Text ff="var(--font-outfit)" fw={600}>{i + 1}. {s.label}</Text>
                    </Group>
                    <Text fz="xs" c="dimmed" lh={1.4}>
                      {st ? Object.entries(st).slice(0, 3).map(([k, v]) => `${k}: ${v}`).join(" · ") : "Not run yet"}
                    </Text>
                  </Card>
                );
              })}
            </SimpleGrid>

            <Tabs value={tab} onChange={setTab} color="gwen" keepMounted={false}>
              <Tabs.List>
                <Tabs.Tab value="sources" leftSection={<IconFileImport size={16} />}>1 · Sources</Tabs.Tab>
                <Tabs.Tab value="validate" leftSection={<IconShieldCheck size={16} />}>2 · Validate</Tabs.Tab>
                <Tabs.Tab value="resolve" leftSection={<IconGitMerge size={16} />}>3 · Resolve</Tabs.Tab>
                <Tabs.Tab value="auth" leftSection={<IconStethoscope size={16} />}>4 · Prior auth</Tabs.Tab>
                <Tabs.Tab value="sql" leftSection={<IconDatabase size={16} />}>SQL</Tabs.Tab>
              </Tabs.List>

              <Tabs.Panel value="sources" pt="md"><Sources state={state} ran={ran} busy={busy} run={run} /></Tabs.Panel>
              <Tabs.Panel value="validate" pt="md"><Validate state={state} ran={ran} busy={busy} run={run} /></Tabs.Panel>
              <Tabs.Panel value="resolve" pt="md"><Resolve state={state} ran={ran} busy={busy} run={run} /></Tabs.Panel>
              <Tabs.Panel value="auth" pt="md"><Auth state={state} ran={ran} busy={busy} run={run} /></Tabs.Panel>
              <Tabs.Panel value="sql" pt="md"><Sql ready={ran.has("resolve")} /></Tabs.Panel>
            </Tabs>
          </Stack>
        )}
        <Text fz="xs" c="dimmed" ta="center" mt="xl">
          Unofficial interview demo. All data is synthetic; Northwind Health Plan is fictional. Not affiliated with or built on Penguin Ai’s production systems.
        </Text>
      </Container>
    </>
  );
}

type PanelProps = { state: State; ran: Set<string>; busy: string | null; run: (s: string[], goto?: string) => Promise<void> };

function Section({ title, hint, action, children }: { title: string; hint: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-start">
        <Stack gap={2}>
          <Title order={3}>{title}</Title>
          <Text c="dimmed" fz="sm" maw={760}>{hint}</Text>
        </Stack>
        {action}
      </Group>
      {children}
    </Stack>
  );
}

function Empty({ text }: { text: string }) {
  return <Paper p="xl" ta="center" c="dimmed" withBorder radius="lg">{text}</Paper>;
}

function Sources({ state, ran, busy, run }: PanelProps) {
  return (
    <Section
      title="Three source systems, three formats"
      hint="What a real onboarding starts with: a FHIR bundle from the provider side, HL7 v2 enrollment updates from a legacy system, and a flat claims export. Nothing here is clean."
      action={<Button leftSection={<IconFileImport size={16} />} loading={busy === "ingest"} disabled={!!busy} onClick={() => run(["ingest"])}>{ran.has("ingest") ? "Re-ingest" : "Ingest sources"}</Button>}
    >
      <SimpleGrid cols={{ base: 1, md: 3 }}>
        {[
          ["FHIR R4 bundle", "Patient · Practitioner · ServiceRequest", state.sources.fhir],
          ["HL7 v2 ADT^A08", "Enrollment updates (note OCONNOR^JIM)", state.sources.hl7],
          ["Claims CSV", "Adjudication system export", state.sources.csv],
        ].map(([t, sub, body]) => (
          <Card key={t} padding="md">
            <Text ff="var(--font-outfit)" fw={600}>{t}</Text>
            <Text fz="xs" c="dimmed" mb="xs">{sub}</Text>
            <ScrollArea h={280} type="auto"><Code block fz={11}>{body}</Code></ScrollArea>
          </Card>
        ))}
      </SimpleGrid>
    </Section>
  );
}

const SEV = { error: "red", warning: "yellow", info: "deep" } as const;

function Validate({ state, ran, busy, run }: PanelProps) {
  const providerIssues = state.issues.filter((i) => i.entity === "provider" && !i.resolved);
  return (
    <Section
      title="Data-quality gate"
      hint="Rule-based checks on every record before anything touches the platform: NPI check digits, ICD-10 format, CPT/diagnosis consistency, orphaned members."
      action={<Button leftSection={<IconShieldCheck size={16} />} loading={busy === "validate"} disabled={!!busy || !ran.has("ingest")} onClick={() => run(["validate"])}>Run validation</Button>}
    >
      {!ran.has("validate") ? <Empty text="Ingest the sources, then run validation." /> : (
        <>
          {providerIssues.length > 0 && (
            <Alert color="gwen" icon={<IconAlertTriangle />} title="Provider onboarding blocks automation">
              <Group justify="space-between">
                <Text fz="sm" maw={680}>{providerIssues.length} providers have missing or invalid NPIs. Any prior auth they submit will be bounced. Enrich them from the provider directory (simulated NPPES lookup) and re-decide.</Text>
                <Button leftSection={<IconUserCheck size={16} />} loading={busy === "fix"} disabled={!!busy || !ran.has("resolve")} onClick={() => run(["fix", "authorize"], "auth")}>
                  Apply directory fix
                </Button>
              </Group>
              {!ran.has("resolve") && <Text fz="xs" c="dimmed" mt={4}>Run Resolve first.</Text>}
            </Alert>
          )}
          <Card padding={0}>
            <Table.ScrollContainer minWidth={700}>
              <Table verticalSpacing="sm" highlightOnHover>
                <Table.Thead><Table.Tr><Table.Th>Severity</Table.Th><Table.Th>Entity</Table.Th><Table.Th>Rule</Table.Th><Table.Th>Detail</Table.Th></Table.Tr></Table.Thead>
                <Table.Tbody>
                  {state.issues.map((i) => (
                    <Table.Tr key={i.id} opacity={i.resolved ? 0.5 : 1}>
                      <Table.Td><Badge color={i.resolved ? "teal" : SEV[i.severity as keyof typeof SEV]} variant="light">{i.resolved ? "resolved" : i.severity}</Badge></Table.Td>
                      <Table.Td><Text fz="sm" fw={500}>{i.entity_ref}</Text><Text fz="xs" c="dimmed">{i.entity}</Text></Table.Td>
                      <Table.Td><Code>{i.rule}</Code></Table.Td>
                      <Table.Td fz="sm">{i.message}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Card>
        </>
      )}
    </Section>
  );
}

function Resolve({ state, ran, busy, run }: PanelProps) {
  return (
    <Section
      title="One record per person"
      hint="Entity resolution across FHIR and HL7: nicknames, punctuation, and missing IDs are reconciled, while same-name people with different birthdates are deliberately kept apart."
      action={<Button leftSection={<IconGitMerge size={16} />} loading={busy === "resolve"} disabled={!!busy || !ran.has("ingest")} onClick={() => run(["resolve"])}>Resolve entities</Button>}
    >
      {!ran.has("resolve") ? <Empty text="Run resolution to build the golden member table in Neon Postgres." /> : (
        <SimpleGrid cols={{ base: 1, lg: 2 }}>
          <Card padding={0}>
            <Text ff="var(--font-outfit)" fw={600} p="md" pb={0}>Golden members</Text>
            <Table verticalSpacing="xs">
              <Table.Thead><Table.Tr><Table.Th>Key</Table.Th><Table.Th>Member</Table.Th><Table.Th>DOB</Table.Th><Table.Th>Sources</Table.Th></Table.Tr></Table.Thead>
              <Table.Tbody>{state.members.map((m) => (
                <Table.Tr key={m.member_key}>
                  <Table.Td><Code>{m.member_key}</Code></Table.Td>
                  <Table.Td fz="sm">{m.full_name}<Text fz="xs" c="dimmed">{m.member_id ?? "no ID"}</Text></Table.Td>
                  <Table.Td fz="sm">{String(m.dob).slice(0, 10)}</Table.Td>
                  <Table.Td><Badge variant={m.source_count > 1 ? "filled" : "light"} color={m.source_count > 1 ? "deep" : "gray"}>{m.source_count} {m.source_count > 1 ? "merged" : "record"}</Badge></Table.Td>
                </Table.Tr>))}</Table.Tbody>
            </Table>
          </Card>
          <Card padding={0}>
            <Text ff="var(--font-outfit)" fw={600} p="md" pb={0}>Why records were linked</Text>
            <ScrollArea h={380}>
              <Table verticalSpacing="xs">
                <Table.Thead><Table.Tr><Table.Th>Member</Table.Th><Table.Th>Source</Table.Th><Table.Th>Score</Table.Th><Table.Th>Rationale</Table.Th></Table.Tr></Table.Thead>
                <Table.Tbody>{state.links.map((l, i) => (
                  <Table.Tr key={i}>
                    <Table.Td fz="sm">{l.full_name}</Table.Td>
                    <Table.Td><Code>{l.source}:{l.source_id}</Code></Table.Td>
                    <Table.Td fz="sm">{Number(l.score).toFixed(2)}</Table.Td>
                    <Table.Td fz="xs" c="dimmed">{l.rationale}</Table.Td>
                  </Table.Tr>))}</Table.Tbody>
              </Table>
            </ScrollArea>
          </Card>
        </SimpleGrid>
      )}
    </Section>
  );
}

const STATUS_ICON = {
  met: <ThemeIcon color="teal" size="sm" radius="xl"><IconCheck size={12} /></ThemeIcon>,
  not_met: <ThemeIcon color="red" size="sm" radius="xl"><IconX size={12} /></ThemeIcon>,
  ambiguous: <ThemeIcon color="yellow" size="sm" radius="xl"><IconHelp size={12} /></ThemeIcon>,
  missing: <ThemeIcon color="gwen" size="sm" radius="xl"><IconAlertTriangle size={12} /></ThemeIcon>,
} as const;

function Auth({ state, ran, busy, run }: PanelProps) {
  const counts = (o: string) => state.decisions.filter((d) => d.outcome === o).length;
  const total = state.decisions.length;
  return (
    <Section
      title="Prior authorization with a Glassbox-style audit trail"
      hint={`Policy ${state.policy.id}: ${state.policy.title}. Each criterion is checked against the note and the member's claims history in Postgres. Only a clean pass is approved; anything else goes to a human with the evidence attached.`}
      action={<Button leftSection={<IconStethoscope size={16} />} loading={busy === "authorize"} disabled={!!busy || !ran.has("resolve")} onClick={() => run(["authorize"])}>Decide requests</Button>}
    >
      {!ran.has("authorize") ? <Empty text="Resolve entities first, then decide the six pending MRI requests." /> : (
        <>
          <SimpleGrid cols={{ base: 2, md: 4 }}>
            <Card padding="md"><Text fz="xs" c="dimmed">Auto-approved</Text><Text fz={32} ff="var(--font-outfit)" fw={600} c="deep.6">{counts("AUTO_APPROVE")}<Text span fz="md" c="dimmed"> / {total}</Text></Text></Card>
            <Card padding="md"><Text fz="xs" c="dimmed">Clinical review</Text><Text fz={32} ff="var(--font-outfit)" fw={600}>{counts("HUMAN_REVIEW")}</Text></Card>
            <Card padding="md"><Text fz="xs" c="dimmed">Info requested</Text><Text fz={32} ff="var(--font-outfit)" fw={600} c="gwen.6">{counts("REQUEST_INFO")}</Text></Card>
            <Card padding="md"><Text fz="xs" c="dimmed">Criteria in policy</Text><List fz="xs" mt={4} spacing={2}>{state.policy.criteria.map((c) => <List.Item key={c.id}><b>{c.id}</b> {c.label}</List.Item>)}</List></Card>
          </SimpleGrid>
          <Accordion variant="separated" radius="lg">
            {state.decisions.map((d) => {
              const req = state.requests.find((r) => r.auth_id === d.auth_id)!;
              const o = OUTCOME[d.outcome as keyof typeof OUTCOME];
              return (
                <Accordion.Item key={d.auth_id} value={d.auth_id}>
                  <Accordion.Control>
                    <Group justify="space-between" pr="sm" wrap="nowrap">
                      <Stack gap={0}>
                        <Text fw={600} ff="var(--font-outfit)">{d.auth_id} · {req.full_name ?? "Unresolved member"}</Text>
                        <Text fz="xs" c="dimmed">CPT {req.cpt} · {req.icd10} · {req.provider_name}</Text>
                      </Stack>
                      <Badge color={o.color} variant="filled" size="lg">{o.label}</Badge>
                    </Group>
                  </Accordion.Control>
                  <Accordion.Panel>
                    <Stack gap="sm">
                      <Text fz="sm">{d.summary}</Text>
                      <Table verticalSpacing="xs">
                        <Table.Tbody>
                          {d.audit.criteria.map((c: Row) => (
                            <Table.Tr key={c.id}>
                              <Table.Td w={30}>{STATUS_ICON[c.status as keyof typeof STATUS_ICON]}</Table.Td>
                              <Table.Td w="38%"><Text fz="sm" fw={600}>{c.id}</Text><Text fz="xs" c="dimmed">{c.label}</Text></Table.Td>
                              <Table.Td fz="sm" fs={c.evidence.startsWith('"') ? "italic" : undefined}>{c.evidence}</Table.Td>
                            </Table.Tr>
                          ))}
                        </Table.Tbody>
                      </Table>
                      <Group gap="xs">{d.audit.steps.map((s: Row, i: number) => <Badge key={i} variant="outline" color="gray" tt="none" title={s.detail}>{i + 1}. {s.actor}</Badge>)}</Group>
                    </Stack>
                  </Accordion.Panel>
                </Accordion.Item>
              );
            })}
          </Accordion>
        </>
      )}
    </Section>
  );
}

function Sql({ ready }: { ready: boolean }) {
  const [queries, setQueries] = useState<{ id: string; label: string }[]>([]);
  const [result, setResult] = useState<{ label: string; sql: string; rows: Row[] } | null>(null);
  useEffect(() => { fetch("/api/query").then((r) => r.json()).then(setQueries); }, []);
  const go = async (id: string) => setResult(await (await fetch("/api/query", { method: "POST", body: JSON.stringify({ id }) })).json());
  const cols = result?.rows[0] ? Object.keys(result.rows[0]) : [];
  return (
    <Section title="Everything lands in real Postgres (Neon)" hint="The mapped data is queryable with plain SQL, which is how an implementation lead answers “can you show me X?” in a customer call. Queries are allow-listed in this public demo.">
      {!ready ? <Empty text="Run the Resolve step to populate the tables." /> : (
        <>
          <Group>{queries.map((qq) => <Button key={qq.id} variant="light" size="xs" onClick={() => go(qq.id)}>{qq.label}</Button>)}</Group>
          {result && (
            <Stack>
              <Code block>{result.sql}</Code>
              <Card padding={0}>
                <Table.ScrollContainer minWidth={600}>
                  <Table verticalSpacing="xs">
                    <Table.Thead><Table.Tr>{cols.map((c) => <Table.Th key={c}>{c}</Table.Th>)}</Table.Tr></Table.Thead>
                    <Table.Tbody>{result.rows.map((r, i) => <Table.Tr key={i}>{cols.map((c) => <Table.Td key={c} fz="sm">{String(r[c] ?? "—").slice(0, 120)}</Table.Td>)}</Table.Tr>)}</Table.Tbody>
                  </Table>
                </Table.ScrollContainer>
                {result.rows.length === 0 && <Text p="md" c="dimmed" fz="sm">No rows.</Text>}
              </Card>
            </Stack>
          )}
        </>
      )}
    </Section>
  );
}
