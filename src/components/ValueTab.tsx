"use client";

import { useEffect, useState } from "react";
import { Alert, Badge, Box, Button, Card, Group, Loader, SimpleGrid, Stack, Table, Text, Textarea, ThemeIcon, Title } from "@mantine/core";
import { BarChart, LineChart } from "@mantine/charts";
import { IconAlertTriangle, IconArrowUpRight, IconCheck, IconRefresh, IconSparkles, IconTrash } from "@tabler/icons-react";

/* eslint-disable @typescript-eslint/no-explicit-any */
type V = {
  trend: Record<string, any>[];
  tiles: { review: { baseline: number; now: number; drop: number }; auto: { now: number }; override: { now: number; since: number }; adoption: { active: number; total: number; pct: number }; cases: { now: number; first: number } };
  signals: { kind: "expand" | "risk" | "ok"; text: string }[];
  overrides: { week: number; auth_ref: string; category: string; reason: string }[];
  requests: { id: number; title: string; problem: string; evidence: string; proposal: string; severity: string; area: string; drafted_by: string }[];
  milestones: { week: number; label: string }[];
  targets: { reviewMin: number; auto: number };
};

const SAMPLES = [
  "Your tool keeps sending imaging requests to review even when the earlier MRI was for the neck, not the lower back. Also my reviewers say the evidence screen takes three clicks to open and Linda says the Excel export has no policy ID column.",
  "We love the speed but our medical director wants to see exactly which sentence in the note the AI used for the therapy criterion, right on the main queue, without opening each case.",
  "Several of our providers have two office locations and the NPI lookup seems to pick the wrong one, so their requests bounce back as missing info.",
];
const SEV = { high: "red", medium: "yellow", low: "gray" } as const;

function Tile({ label, value, sub, accent }: { label: string; value: string; sub: string; accent?: string }) {
  return (
    <Card padding="md">
      <Text fz="xs" c="dimmed">{label}</Text>
      <Text fz={30} ff="var(--font-outfit)" fw={600} c={accent}>{value}</Text>
      <Text fz="xs" c="dimmed">{sub}</Text>
    </Card>
  );
}

export function ValueTab({ onRestart }: { onRestart: () => void }) {
  const [v, setV] = useState<V | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/value", { cache: "no-store" }).then((r) => r.json()).then((j) => (j.error ? setErr(j.error) : setV(j)));
  }, []);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/feedback", { method: "POST", body: JSON.stringify({ text }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error);
      setV(j);
      setText("");
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };
  const clear = async () => {
    await fetch("/api/feedback", { method: "POST", body: JSON.stringify({ clear: true }) });
    setV(await (await fetch("/api/value", { cache: "no-store" })).json());
  };

  if (!v) return <Group justify="center" py={60}>{err ? <Text c="red">{err}</Text> : <><Loader color="gwen" /><Text c="dimmed">Loading 12 weeks of history…</Text></>}</Group>;
  const t = v.tiles;
  const lines = v.milestones.map((m) => ({ x: `W${m.week}`, label: m.label, color: "gray.6" }));

  return (
    <Stack gap="md">
      <Stack gap={2}>
        <Title order={3}>Month 3 value review</Title>
        <Text c="dimmed" fz="sm" maw={800}>
          What I would bring to the customer&apos;s 90-day review: measured change against the week-one baseline, why humans overrode the AI, what to fix, what to build next, and where renewal risk sits.
          All figures are synthetic and illustrative, not Penguin Ai data.
        </Text>
      </Stack>

      <SimpleGrid cols={{ base: 2, md: 4 }}>
        <Tile label="Avg review time per case" value={`${t.review.now.toFixed(1)} min`} sub={`from ${t.review.baseline.toFixed(1)} min baseline (−${t.review.drop.toFixed(0)}%)`} accent="var(--mantine-color-deep-6)" />
        <Tile label="Resolved without human touch" value={`${t.auto.now.toFixed(0)}%`} sub={`baseline 0% (all manual). Published claim: up to ${v.targets.auto}%`} accent="var(--mantine-color-deep-6)" />
        <Tile label="Reviewer override rate" value={`${t.override.now.toFixed(1)}%`} sub={`${t.override.since.toFixed(1)}% since go-live, falling`} />
        <Tile label="Reviewer adoption" value={`${t.adoption.active}/${t.adoption.total}`} sub={`${t.adoption.pct.toFixed(0)}% active this week`} accent={t.adoption.pct < 90 ? "var(--mantine-color-gwen-6)" : undefined} />
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, lg: 2 }}>
        <Card>
          <Text ff="var(--font-outfit)" fw={600} mb="xs">Automation and information requests (% of cases)</Text>
          <LineChart h={250} data={v.trend} dataKey="week" curveType="monotone" withLegend
            series={[{ name: "Auto-resolved %", color: "deep.6" }, { name: "Info requested %", color: "gwen.6" }]}
            referenceLines={lines} yAxisProps={{ domain: [0, 100] }} />
          <Text fz="xs" c="dimmed" mt={6}>Info requests collapse after the NPI directory fix in week 7: the data-quality lever from the demo, seen over time.</Text>
        </Card>
        <Card>
          <Text ff="var(--font-outfit)" fw={600} mb="xs">Average review minutes per case</Text>
          <LineChart h={250} data={v.trend} dataKey="week" curveType="monotone" withLegend
            series={[{ name: "Avg review minutes", color: "deep.6" }]}
            referenceLines={[...lines, { y: v.targets.reviewMin, label: "Published example: 4 min", color: "gwen.6" }]} />
          <Text fz="xs" c="dimmed" mt={6}>Weeks 1–4 are the pre-go-live baseline. The pink line is Penguin Ai&apos;s published example, shown as a target to validate, not a result.</Text>
        </Card>
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, lg: 2 }}>
        <Card>
          <Text ff="var(--font-outfit)" fw={600} mb="xs">Reviewer overrides per week</Text>
          <BarChart h={200} data={v.trend} dataKey="week" series={[{ name: "Overrides", color: "gwen.6" }]} />
        </Card>
        <Card padding={0}>
          <Text ff="var(--font-outfit)" fw={600} p="md" pb={0}>Sampled overrides: why humans disagreed</Text>
          <Box mah={260} style={{ overflow: "auto" }}>
            <Table verticalSpacing="xs" fz="sm">
              <Table.Thead><Table.Tr><Table.Th>Case</Table.Th><Table.Th>Category</Table.Th><Table.Th>Reviewer reason</Table.Th></Table.Tr></Table.Thead>
              <Table.Tbody>{v.overrides.map((o) => (
                <Table.Tr key={o.auth_ref}><Table.Td>{o.auth_ref}<Text fz="xs" c="dimmed">W{o.week}</Text></Table.Td><Table.Td><Badge variant="light" color="deep" tt="none">{o.category}</Badge></Table.Td><Table.Td fz="xs">{o.reason}</Table.Td></Table.Tr>
              ))}</Table.Tbody>
            </Table>
          </Box>
        </Card>
      </SimpleGrid>

      <Card>
        <Text ff="var(--font-outfit)" fw={600} mb="xs">What I would do next</Text>
        <Stack gap="xs">
          {v.signals.map((s, i) => (
            <Group key={i} wrap="nowrap" align="flex-start">
              <ThemeIcon size="sm" radius="xl" color={s.kind === "risk" ? "gwen" : s.kind === "expand" ? "deep" : "gray"} variant={s.kind === "ok" ? "light" : "filled"}>
                {s.kind === "risk" ? <IconAlertTriangle size={12} /> : s.kind === "expand" ? <IconArrowUpRight size={12} /> : <IconCheck size={12} />}
              </ThemeIcon>
              <Text fz="sm"><b>{s.kind === "expand" ? "Expansion: " : s.kind === "risk" ? "Renewal risk: " : "Tune: "}</b>{s.text}</Text>
            </Group>
          ))}
        </Stack>
      </Card>

      <Card>
        <Group justify="space-between" mb="xs">
          <Text ff="var(--font-outfit)" fw={600}>Voice of the customer to product request</Text>
          {v.requests.length > 0 && <Button size="compact-xs" variant="subtle" color="gray" leftSection={<IconTrash size={12} />} onClick={clear}>Clear saved requests</Button>}
        </Group>
        <Textarea placeholder="Paste messy customer feedback…" minRows={3} autosize value={text} onChange={(e) => setText(e.currentTarget.value)} />
        <Group mt="xs" gap="xs">
          {SAMPLES.map((s, i) => <Button key={i} size="compact-xs" variant="light" color="gray" onClick={() => setText(s)}>Sample {i + 1}</Button>)}
          <Button ml="auto" leftSection={busy ? <Loader size={14} color="white" /> : <IconSparkles size={16} />} disabled={busy || text.trim().length < 10} onClick={submit}>Turn into a product request</Button>
        </Group>
        {err && <Alert color="red" mt="sm">{err}</Alert>}
        <Stack mt="md" gap="sm">
          {v.requests.map((r) => (
            <Card key={r.id} padding="sm" bg="#faf7f2">
              <Group justify="space-between" mb={4}>
                <Text fw={600} ff="var(--font-outfit)">{r.title}</Text>
                <Group gap={6}><Badge color={SEV[r.severity as keyof typeof SEV] ?? "gray"} variant="filled">{r.severity}</Badge><Badge variant="outline" color="deep" tt="none">{r.area}</Badge></Group>
              </Group>
              <Text fz="sm"><b>Problem:</b> {r.problem}</Text>
              <Text fz="sm"><b>Proposal:</b> {r.proposal}</Text>
              <Text fz="sm" fs="italic" c="dimmed">Evidence: “{r.evidence}”</Text>
              <Text fz="xs" c="dimmed" mt={4}>Drafted by {r.drafted_by}. Review before sending to Product.</Text>
            </Card>
          ))}
        </Stack>
      </Card>
      <Group justify="flex-end">
        <Button variant="default" leftSection={<IconRefresh size={16} />} onClick={onRestart}>Back to the start: Onboarding plan</Button>
      </Group>
    </Stack>
  );
}
