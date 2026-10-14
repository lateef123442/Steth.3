import React, { useEffect, useState } from "react";
import { View, Text } from "react-native";
import { colors, spacing, type } from "../../theme/tokens";
import { Bar, Btn, Card, Label, Muted, Tag, s } from "../../components/study/ui";
import { Grid } from "../../components/responsive";
import { CourseStats, fetchTopicProgress } from "../../lib/courseApi";

const tone = (p: number) => (p >= 75 ? colors.success : p >= 50 ? colors.ember : colors.danger);

/** Class overview: size, activity, who has finished the topics, hardest questions and weak topics. */
export default function TeacherInsightsPanel({ courseId, stats, onDelete }: { courseId: string; stats: CourseStats; onDelete: () => void }) {
  const [prog, setProg] = useState<{ topic_count: number; students: { name: string; done: number }[] } | null>(null);
  useEffect(() => { fetchTopicProgress(courseId).then(setProg).catch(() => setProg(null)); }, [courseId]);

  return (
    <>
      <Grid max={4} gap={spacing.sm}>
        {[[`${stats.member_count}`, "students in this class"], [`${stats.active_7d}`, "active this week"], [`${stats.answers_total}`, "practice answers"], [stats.accuracy == null ? "—" : `${stats.accuracy}%`, "class accuracy"]].map(([v, k]) => (
          <Card key={k}><Text style={s.h2}>{v}</Text><Muted>{k}</Muted></Card>
        ))}
      </Grid>

      <Label>TOPIC PROGRESS</Label>
      {!prog || prog.topic_count === 0 ? <Muted>Add topics to track how far each student has got.</Muted> : prog.students.length === 0 ? <Muted>No students in this class yet.</Muted> : (
        <Grid>
          {prog.students.slice(0, 60).map((st, i) => (
            <Card key={i}>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}><Text style={type.bodyMedium} numberOfLines={1}>{st.name}</Text><Muted>{st.done}/{prog.topic_count}</Muted></View>
              <View style={{ marginTop: 6 }}><Bar value={prog.topic_count ? st.done / prog.topic_count : 0} color={st.done === prog.topic_count ? colors.success : colors.teal} /></View>
            </Card>
          ))}
        </Grid>
      )}

      <Label>HARDEST QUESTIONS</Label>
      {stats.hardest.length === 0 && <Muted>Needs at least 3 answers per question. Students' practice results appear here automatically.</Muted>}
      <Grid>
        {stats.hardest.map((h) => (
          <Card key={h.question_id}>
            <Text style={type.bodyMedium} numberOfLines={3}>{h.question}</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: 6 }}><Tag label={`${h.pct_correct}% correct`} color={tone(h.pct_correct)} /><Muted>{h.attempts} attempts{h.topic ? ` · ${h.topic}` : ""}</Muted></View>
          </Card>
        ))}
      </Grid>

      <Label>TOPICS TO REVISIT IN CLASS</Label>
      <Grid>
        {stats.topics.map((t) => (
          <Card key={t.topic}>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}><Text style={[s.h3, { flex: 1 }]} numberOfLines={1}>{t.topic}</Text><Muted>{t.pct_correct}% · {t.attempts}</Muted></View>
            <View style={{ marginTop: 6 }}><Bar value={t.pct_correct / 100} color={tone(t.pct_correct)} /></View>
          </Card>
        ))}
      </Grid>

      <Label>STUDENTS (LOWEST ACCURACY FIRST)</Label>
      {stats.students.length === 0 && <Muted>No practice answers yet.</Muted>}
      <Grid>
        {stats.students.slice(0, 30).map((st, i) => (
          <Card key={i} style={{ flexDirection: "row", justifyContent: "space-between" }}><Text style={[type.bodyMedium, { flex: 1 }]} numberOfLines={1}>{st.name}</Text><Muted>{st.accuracy}% · {st.answers}</Muted></Card>
        ))}
      </Grid>
      <Btn ghost danger label="Delete course" onPress={onDelete} />
    </>
  );
}
