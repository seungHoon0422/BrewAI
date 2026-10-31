// UI 부품 모음 — 모든 토큰 · 부품을 라이트 · 다크로 나란히 (개발 서버 전용 화면, 관리자 콘솔 #/ui 가 띄운다).
// 다시 그릴 때 = tokens.css · 부품 CSS 를 바꾸고 여기서 한눈에 확인 → 그다음 앱 화면.
import { useMemo, useState, type ReactNode } from 'react';
import '../styles/index.css';
import './gallery.css';
import { Button, IconButton, LinkButton } from '../button';
import { Field } from '../field';
import { ICON_NAMES, Icon, Mark } from '../icons';
import { Checkbox, Input, PasswordInput, Segmented, Switch, Textarea, passwordStrength } from '../inputs';
import { Select } from '../select';
import { Dialog, Menu, Popover, Sheet, Tooltip } from '../overlays';
import { PROVIDER_IDS, ProviderIcon, providerLabel } from '../providers';
import { Skeleton, Spinner } from '../spinner';
import { Toast, ToastRegion, useToastQueue } from '../toast';
import { Avatar, Badge, Callout, Card, CardHeader, Chip, EmptyState, Kbd, KeyValue, Meta, StatCard, StatusDot, type DotState, type Tone } from '../display';
import { Table, type Column, type SortState } from '../table';
import { Breadcrumb, PageHeader, Tabs, Toolbar, ToolbarSpacer } from '../navigation';
import { kindIcon } from '../scope';
import { BarList, ShareBar, StatTile, TimeSeriesChart, deltaOf, vizSlot } from '../charts';
import { CHART_DAYS, CHART_ERRORS, CHART_MODELS, CHART_ORGS, CHART_RUNS, COPY, KIND_LABEL, LONG_PATH, MODEL_CAPS, MODELS, SCOPE_PATH, STATE_TEXT, type SampleModel } from './copy';

type ThemeMode = 'both' | 'light' | 'dark';

export default function Gallery({ backHref }: { backHref?: string }) {
  const [mode, setMode] = useState<ThemeMode>('both');
  const themes = mode === 'both' ? (['light', 'dark'] as const) : ([mode] as const);
  return (
    <div className="gal">
      <header className="gal-top">
        <Mark size={24} />
        <div className="gal-titles">
          <h1>{COPY.title}</h1>
          <p>{COPY.desc}</p>
        </div>
        <Segmented
          label={COPY.themeLabel}
          value={mode}
          onChange={setMode}
          options={[
            { value: 'both', label: COPY.themes.both },
            { value: 'light', label: COPY.themes.light, icon: 'sun' },
            { value: 'dark', label: COPY.themes.dark, icon: 'moon' },
          ]}
        />
        {backHref && <LinkButton href={backHref} variant="ghost" icon="chevron-left">{COPY.back}</LinkButton>}
      </header>
      <div className="gal-cols" data-count={themes.length}>
        {themes.map((t) => (
          <div key={t} className="gal-col" data-theme={t} data-gallery-theme={t}>
            <p className="gal-col-name">{COPY.themes[t]}</p>
            <Showcase />
          </div>
        ))}
      </div>
    </div>
  );
}

function Sec({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="gal-sec">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

const Row = ({ children, label }: { children: ReactNode; label?: string }) => (
  <div className="gal-row">
    {label && <span className="gal-label">{label}</span>}
    {children}
  </div>
);

function Showcase() {
  return (
    <>
      <Tokens />
      <Buttons />
      <Inputs />
      <Choice />
      <DisplayBits />
      <Cards />
      <TableDemo />
      <Charts />
      <Overlays />
      <Nav />
      <Icons />
      <Wait />
    </>
  );
}

/* 토큰 */
const SWATCHES = [
  ['surface-app', 'surface', 'surface-sunken', 'surface-chip', 'surface-hover', 'surface-active'],
  ['text', 'text-2', 'text-muted', 'text-faint', 'border-strong', 'border', 'border-subtle'],
  ['accent', 'info', 'ok', 'warn', 'danger', 'info-soft', 'ok-soft', 'warn-soft', 'danger-soft'],
  ['viz-1', 'viz-2', 'viz-3', 'viz-4', 'viz-5', 'viz-6', 'viz-7', 'viz-8', 'viz-other', 'viz-grid', 'viz-axis'],
];
const TYPE = ['2xs', 'xs', 'sm', 'base', 'md', 'lg', 'xl', '2xl'];
const RADII = ['sm', 'md', 'lg', 'xl', '2xl', 'pill'];

function Tokens() {
  return (
    <>
      <Sec title={COPY.sections.color}>
        {SWATCHES.map((group, i) => (
          <div key={i} className="gal-swatches">
            {group.map((name) => (
              <span key={name} className="gal-swatch">
                <i style={{ background: `var(--${name})` }} />
                <code>--{name}</code>
              </span>
            ))}
          </div>
        ))}
      </Sec>
      <Sec title={COPY.sections.type}>
        <div className="gal-type">
          {TYPE.map((s) => (
            <p key={s} style={{ fontSize: `var(--fs-${s})` }}>
              <code>--fs-{s}</code> 에이전트가 필요한 도구를 찾았어요 1,234
            </p>
          ))}
          <p className="gal-weights">
            <span style={{ fontWeight: 'var(--fw-regular)' }}>보통 400</span>
            <span style={{ fontWeight: 'var(--fw-medium)' }}>중간 500</span>
            <span style={{ fontWeight: 'var(--fw-semibold)' }}>굵게 600</span>
            <span style={{ fontFamily: 'var(--font-mono)' }}>mono claude-sonnet</span>
          </p>
        </div>
      </Sec>
      <Sec title={COPY.sections.shape}>
        <div className="gal-shapes">
          {RADII.map((r) => (
            <span key={r} className="gal-shape" style={{ borderRadius: `var(--radius-${r})` }}><code>{r}</code></span>
          ))}
        </div>
        <div className="gal-shapes">
          {['sm', 'md', 'lg'].map((s) => (
            <span key={s} className="gal-shape" data-elev style={{ boxShadow: `var(--shadow-${s})` }}><code>shadow-{s}</code></span>
          ))}
          <span className="gal-shape ui-glass" data-glass><code>ui-glass</code></span>
        </div>
      </Sec>
    </>
  );
}

/* 버튼 */
function Buttons() {
  const [busy, setBusy] = useState(false);
  return (
    <Sec title={COPY.sections.buttons}>
      {(['primary', 'secondary', 'ghost', 'danger'] as const).map((v) => (
        <Row key={v} label={v}>
          <Button variant={v} size="sm">작게</Button>
          <Button variant={v}>보통</Button>
          <Button variant={v} size="lg">크게</Button>
          <Button variant={v} icon={v === 'danger' ? 'trash' : 'plus'}>아이콘</Button>
          <Button variant={v} disabled>꺼짐</Button>
        </Row>
      ))}
      <Row label="상태">
        <Button variant="primary" loading={busy} onClick={() => { setBusy(true); setTimeout(() => setBusy(false), 1500); }}>
          {busy ? '저장하는 중' : '눌러서 기다림'}
        </Button>
        <Button iconEnd="chevron-down">펼치기</Button>
        <LinkButton href="#/ui" iconEnd="external">링크 버튼</LinkButton>
      </Row>
      <Row label="아이콘">
        <IconButton icon="panel" label="사이드바" size="sm" />
        <IconButton icon="search" label="검색" />
        <IconButton icon="gear" label="설정" size="lg" />
        <IconButton icon="refresh" label="새로 고침" variant="secondary" />
        <IconButton icon="panel" label="켜짐" pressed />
        <IconButton icon="trash" label="꺼짐" disabled />
      </Row>
    </Sec>
  );
}

/* 입력 */
function Inputs() {
  const [pw, setPw] = useState('correct horse battery');
  const [email, setEmail] = useState('dev@brewai');
  return (
    <Sec title={COPY.sections.inputs}>
      <div className="gal-form">
        <Field label="이메일" hint="로그인 ID 예요" required error={email.includes('.') ? undefined : '이메일 모양이 아니에요'}>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />
        </Field>
        <Field label="비밀번호" hint="15자 이상, 조합 규칙 없음" aside={<a href="#/ui">비밀번호를 잊었어요</a>}>
          <PasswordInput value={pw} onChange={(e) => setPw(e.target.value)} strength={passwordStrength(pw, 15)} autoComplete="new-password" />
        </Field>
        <Field label="닉네임">
          <Input defaultValue="승훈" size="lg" />
        </Field>
        <Field label="검색">
          <Input type="search" icon="search" placeholder="모델 이름이나 id" size="sm" />
        </Field>
        <Field label="지침" hint="이 프로젝트 대화의 시스템 프롬프트 뒤에 붙어요">
          <Textarea placeholder="예: 답은 한국어로 짧게" rows={2} />
        </Field>
        <Field label="스페이스">
          <Select defaultValue="s1" options={[{ value: 's1', label: '내 스페이스' }, { value: 's2', label: '제품팀' }, { value: 's3', label: '보관됨', disabled: true }]} />
        </Field>
        <Field label="꺼진 입력" disabled>
          <Input value="바꿀 수 없음" readOnly />
        </Field>
      </div>
    </Sec>
  );
}

/* 고르기 */
function Choice() {
  const [on, setOn] = useState(true);
  const [seg, setSeg] = useState<'off' | 'low' | 'high'>('low');
  const [tab, setTab] = useState<'all' | 'exposed' | 'hidden'>('all');
  const [chips, setChips] = useState<string[]>(['anthropic']);
  const toggleChip = (id: string) => setChips((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  return (
    <Sec title={COPY.sections.choice}>
      <Row label="체크">
        <Checkbox label="켬" defaultChecked />
        <Checkbox label="끔" />
        <Checkbox label="일부" indeterminate readOnly />
        <Checkbox label="설명 있음" description="두 번째 줄 설명" />
        <Checkbox label="꺼짐" disabled />
      </Row>
      <Row label="스위치">
        <Switch checked={on} onCheckedChange={setOn} label="사용자에게 보이기" />
        <Switch checked={!on} onCheckedChange={(v) => setOn(!v)} aria-label="작은 스위치" size="sm" />
        <Switch checked={false} disabled aria-label="꺼진 스위치" />
      </Row>
      <Row label="나눔">
        <Segmented label="생각 깊이" value={seg} onChange={setSeg}
          options={[{ value: 'off', label: '끄기' }, { value: 'low', label: '보통' }, { value: 'high', label: '깊게' }]} />
        <Segmented label="작게" size="sm" value={seg} onChange={setSeg}
          options={[{ value: 'off', label: '끄기' }, { value: 'low', label: '보통' }, { value: 'high', label: '깊게' }]} />
      </Row>
      <Row label="칩">
        {['anthropic', 'openai', 'google'].map((p, i) => (
          <Chip key={p} selected={chips.includes(p)} onClick={() => toggleChip(p)} icon={<ProviderIcon provider={p} size="sm" />} count={i + 2}>
            {providerLabel(p)}
          </Chip>
        ))}
      </Row>
      <Tabs label="상태" value={tab} onChange={setTab}
        items={[{ id: 'all', label: '전체', count: 5 }, { id: 'exposed', label: '노출', count: 2 }, { id: 'hidden', label: '숨김', count: 1 }]}
        actions={<><span className="gal-note">3분 전</span><Button size="sm" icon="refresh">동기화</Button></>}>
        <p className="gal-note">탭 내용 — {tab}. 탭 줄 오른쪽 = actions</p>
      </Tabs>
      <Tabs label="거르개" variant="pill" value={tab} onChange={setTab}
        items={[{ id: 'all', label: '전체' }, { id: 'exposed', label: '노출' }, { id: 'hidden', label: '숨김' }]} />
    </Sec>
  );
}

/* 배지 · 점 · 아바타 */
const TONES: Tone[] = ['neutral', 'info', 'ok', 'warn', 'danger', 'accent'];
const DOTS: DotState[] = ['idle', 'run', 'wait', 'ok', 'warn', 'fail', 'stop'];

function DisplayBits() {
  return (
    <Sec title={COPY.sections.display}>
      {(['soft', 'outline', 'solid'] as const).map((v) => (
        <Row key={v} label={v}>
          {TONES.map((t) => <Badge key={t} tone={t} variant={v} dot={v === 'soft' && t !== 'neutral' && t !== 'accent'}>{t}</Badge>)}
        </Row>
      ))}
      <Row label="작게">
        <Badge size="sm">준비 중</Badge>
        <Badge size="sm" tone="accent">기본</Badge>
        <Badge size="sm" mono>v1.4.2</Badge>
        <Badge size="sm" variant="outline" tone="warn">이름 겹침</Badge>
      </Row>
      <Row label="점">
        {DOTS.map((d) => <span key={d} className="gal-dot"><StatusDot state={d} />{d}</span>)}
      </Row>
      <Row label="아바타">
        {['백승훈', '승훈', 'Seung Hoon', 'dev', '김', 'Ada Lovelace'].map((n, i) => (
          <Avatar key={n} name={n} size={(['xs', 'sm', 'md', 'lg', 'md', 'md'] as const)[i]} />
        ))}
      </Row>
      <Row label="키와 툴팁">
        <Kbd keys={['⌘', 'K']} />
        <Kbd>Esc</Kbd>
        <Tooltip content="툴팁 — 손을 올리거나 포커스하면 떠요">
          <Button size="sm" variant="ghost" icon="info">툴팁</Button>
        </Tooltip>
      </Row>
    </Sec>
  );
}

/* 카드 · 알림 · 빈 상태 */
function Cards() {
  const [pick, setPick] = useState('exposed');
  return (
    <Sec title={COPY.sections.cards}>
      <div className="gal-stats">
        <StatCard label="노출" value={2} sub="사용자 앱에 보임" icon="check" pressed={pick === 'exposed'} onClick={() => setPick('exposed')} />
        <StatCard label="새로 들어옴" value={1} sub="게이트웨이에서" tone="info" pressed={pick === 'candidate'} onClick={() => setPick('candidate')} />
        <StatCard label="연결 실패" value={1} sub="최근 시험" tone="danger" pressed={pick === 'fail'} onClick={() => setPick('fail')} />
      </div>
      <Card>
        <CardHeader title="게이트웨이" description={<Meta items={['LiteLLM', '127.0.0.1:4000']} />} icon="plug" actions={<Badge tone="ok" dot>연결됨</Badge>} />
      </Card>
      <Card variant="glass" padding="sm">
        <span className="gal-live"><Spinner size="xs" /><Meta items={['질문을 살펴보는 중', '1.2초']} /></span>
      </Card>
      <Callout title="모델 등록은 게이트웨이에서">여기서는 노출, 표시 이름, 순서만 정해요.</Callout>
      <Callout tone="info" live>새 모델 1개가 들어왔어요.</Callout>
      <Callout tone="ok">저장했어요.</Callout>
      <Callout tone="warn" title="이름이 겹쳐요" action={<Button size="sm">이름 바꾸기</Button>}>사용자 앱 메뉴에서 둘이 같아 보여요.</Callout>
      <Callout tone="danger" onDismiss={() => undefined}>게이트웨이에 연결할 수 없어요 — npm run gateway</Callout>
      <KeyValue items={[
        { label: '게이트웨이 id', value: 'anthropic/claude-sonnet', mono: true },
        { label: '컨텍스트', value: '200K', aside: '게이트웨이 값' },
        { label: '등록한 곳', value: 'config.yaml' },
      ]} />
      <EmptyState title="아직 연결된 앱이 없어요" icon="link" action={<Button variant="primary" icon="plus">앱 연결</Button>}>
        <p>에이전트가 필요할 때 연결을 제안해요. 승인은 사람이 해요.</p>
      </EmptyState>
    </Sec>
  );
}

/* 표 */
const STATE_TONE: Record<SampleModel['state'], Tone> = { exposed: 'ok', hidden: 'neutral', candidate: 'info', missing: 'warn' };

function TableDemo() {
  const [sort, setSort] = useState<SortState>({ key: 'name', dir: 'asc' });
  const [selected, setSelected] = useState<Set<string>>(() => new Set(['gpt-mini']));
  const [active, setActive] = useState<string>();
  const rows = useMemo(() => {
    if (!sort) return MODELS;
    const by = (m: SampleModel) => (sort.key === 'ctx' ? m.ctx : m.name);
    return [...MODELS].sort((a, b) => (by(a) < by(b) ? -1 : by(a) > by(b) ? 1 : 0) * (sort.dir === 'asc' ? 1 : -1));
  }, [sort]);
  const columns: Column<SampleModel>[] = [
    {
      key: 'name', header: '모델', sortable: true, rowHeader: true,
      cell: (m) => <span className="gal-model"><ProviderIcon provider={m.provider} />{m.name}{m.isDefault && <Badge size="sm" tone="accent">기본</Badge>}</span>,
    },
    { key: 'state', header: '상태', cell: (m) => <Badge tone={STATE_TONE[m.state]} dot>{STATE_TEXT[m.state]}</Badge> },
    { key: 'ctx', header: '컨텍스트', sortable: true, hideBelow: 'md', cell: (m) => <span className="ui-num">{m.ctx}K</span> },
    { key: 'on', header: '노출', cell: (m) => <Switch size="sm" checked={m.state === 'exposed'} aria-label={`${m.name} 노출`} onClick={(e) => e.stopPropagation()} /> },
  ];
  return (
    <Sec title={COPY.sections.table}>
      <Table label="모델" columns={columns} rows={rows} rowKey={(m) => m.id} sort={sort} onSortChange={setSort}
        selected={selected} onSelectedChange={setSelected} onRowClick={(m) => setActive(m.id)} activeKey={active}
        rowState={(m) => m.state} />
      <Table label="빈 표" density="compact" columns={columns.slice(0, 2)} rows={[]} rowKey={(m) => m.id}
        empty={<EmptyState variant="plain" title="조건에 맞는 모델이 없어요">검색어를 지워 보세요.</EmptyState>} />
      <Table label="불러오는 표" density="compact" columns={columns.slice(0, 2)} rows={[]} rowKey={(m) => m.id} loading />
    </Sec>
  );
}

/* 차트 (인라인 SVG · 축 하나 · 색 = --viz-N 순서 고정 · 표 보기) */
const dayLabel = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

function Charts() {
  const half = CHART_RUNS.length / 2;
  const sum = (a: readonly number[]) => a.reduce((n, v) => n + v, 0);
  const now = sum(CHART_RUNS.slice(half));
  const before = sum(CHART_RUNS.slice(0, half));
  return (
    <Sec title={COPY.sections.charts}>
      <div className="gal-stats">
        <StatTile label="호출 수" value={now.toLocaleString('ko-KR')} delta={deltaOf(now, before)} sub="지난 7일 대비" trend={CHART_RUNS.slice(half)} icon="chat" href="#/ui" />
        <StatTile label="실패율" value="3.1%" delta={deltaOf(4, 3, { upIsGood: false })} trend={CHART_ERRORS.slice(half)} icon="alert" />
        <StatTile label="추정 비용" value="$1.24" sub="가격 모르는 모델 제외" icon="receipt" />
      </div>
      <TimeSeriesChart label="호출 추이" x={CHART_DAYS} xLabel={dayLabel} area
        series={[{ id: 'runs', label: '호출', values: CHART_RUNS, color: 1 }, { id: 'errors', label: '실패', values: CHART_ERRORS, color: 2 }]} />
      <TimeSeriesChart label="한 계열" x={CHART_DAYS.slice(0, 7)} xLabel={dayLabel} height={120} area
        series={[{ id: 'tokens', label: '토큰', values: [1200, 3400, 2100, 0, 5100, 4300, 3900], color: 1 }]} />
      <BarList label="조직별 호출" items={CHART_ORGS.map((o) => ({ ...o, href: '#/ui', aside: `${Math.round((o.value / 1945) * 100)}%` }))} />
      <ShareBar label="모델별 비중" items={CHART_MODELS.map((m, i) => ({ ...m, color: m.key === 'other' ? 'other' : vizSlot(i) }))} />
    </Sec>
  );
}

/* 떠 있는 층 */
function Overlays() {
  const [dialog, setDialog] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [picked, setPicked] = useState('claude-sonnet');
  const [prov, setProv] = useState('all');
  const [days, setDays] = useState('7');
  const { toasts, push, dismiss } = useToastQueue();
  const provOptions = [
    { value: 'all', label: '전체 제공사', description: '12개' },
    ...PROVIDER_IDS.slice(0, 6).map((p, i) => ({ value: p, label: providerLabel(p), icon: <ProviderIcon provider={p} size="sm" />, description: `${i + 1}개`, disabled: i === 5 })),
  ];
  return (
    <Sec title={COPY.sections.overlays}>
      <div className="gal-pop-stage">
        <Popover defaultOpen label="모델" placement="bottom-start" width={260}
          trigger={(p) => <Button {...p} iconEnd="chevron-down" icon={<ProviderIcon provider="anthropic" size="sm" />}>Claude Sonnet</Button>}>
          <div className="gal-pop">
            <Input size="sm" icon="search" placeholder="모델 찾기" />
            <p className="gal-note">팝오버 = 유리, 1px 선, shadow-md</p>
          </div>
        </Popover>
        <Menu label="모델 고르기" placement="bottom-end" onSelect={setPicked}
          trigger={(p) => <Button {...p} variant="ghost" iconEnd="chevron-down">메뉴</Button>}
          items={[
            { kind: 'heading', label: 'Anthropic' },
            { id: 'claude-sonnet', label: 'Claude Sonnet', icon: <ProviderIcon provider="anthropic" size="sm" />, checked: picked === 'claude-sonnet', hint: '기본' },
            { id: 'gpt-mini', label: 'GPT mini', icon: <ProviderIcon provider="openai" size="sm" />, checked: picked === 'gpt-mini' },
            { kind: 'separator' },
            { id: 'off', label: '사용 안 함', checked: picked === 'off', disabled: true },
          ]} />
        <Menu label="더 보기" placement="bottom-end" onSelect={() => undefined}
          trigger={(p) => <IconButton {...p} icon="more" label="더 보기" />}
          items={[{ id: 'rename', label: '이름 바꾸기', icon: 'pen' }, { id: 'copy', label: 'id 복사', icon: 'copy', hint: '⌘C' }, { kind: 'separator' }, { id: 'del', label: '지우기', icon: 'trash', danger: true }]} />
      </div>
      <Row label="고르기 상자">
        <Select aria-label="제공사" options={provOptions} value={prov} onChange={setProv} />
        <Select size="sm" aria-label="기간" options={[{ value: '1', label: '1일' }, { value: '7', label: '7일' }, { value: '30', label: '30일' }]} value={days} onChange={setDays} />
        <Select size="sm" aria-label="꺼진 고르기" options={[{ value: 'a', label: '바꿀 수 없음' }]} value="a" disabled />
      </Row>
      <Row label="열기">
        <Button onClick={() => setDialog(true)}>대화상자</Button>
        <Button onClick={() => setSheet(true)}>서랍</Button>
        <Button onClick={() => push({ title: '저장했어요', tone: 'ok' })}>알림 (ok)</Button>
        <Button onClick={() => push({ title: '연결 실패', body: '게이트웨이 응답 없음', tone: 'danger', action: { label: '다시', onClick: () => undefined } })}>알림 (danger)</Button>
      </Row>
      <div className="gal-toasts">
        <Toast title="새 모델 1개" body="Gemini Flash 가 게이트웨이에 들어왔어요" tone="info" action={{ label: '보기', onClick: () => undefined }} />
        <Toast title="이름을 바꿨어요" tone="neutral" onDismiss={() => undefined} />
      </div>
      <Dialog open={dialog} onClose={() => setDialog(false)} title="스페이스 나가기" description="나가면 이 스페이스의 대화를 볼 수 없어요."
        footer={<><Button variant="ghost" onClick={() => setDialog(false)}>취소</Button><Button variant="danger" onClick={() => setDialog(false)}>나가기</Button></>}>
        <Field label="스페이스 이름을 적어 확인"><Input placeholder="제품팀" /></Field>
        <Field label="옮길 곳"><Select options={provOptions} value={prov} onChange={setProv} /></Field>
      </Dialog>
      <Sheet open={sheet} onClose={() => setSheet(false)} title="Claude Sonnet" description="anthropic/claude-sonnet"
        footer={<Button variant="primary" onClick={() => setSheet(false)}>저장</Button>}>
        <KeyValue variant="plain" items={[{ label: '상태', value: <Badge tone="ok" dot>노출</Badge> }, { label: '컨텍스트', value: '200K' }]} />
      </Sheet>
      <ToastRegion toasts={toasts} onDismiss={dismiss} />
    </Sec>
  );
}

/* 길 찾기 */
function Nav() {
  const [at, setAt] = useState(SCOPE_PATH[SCOPE_PATH.length - 1].name);
  return (
    <Sec title={COPY.sections.nav}>
      <Breadcrumb path={SCOPE_PATH} kindLabel={(k) => KIND_LABEL[k]} kindIcon={kindIcon}
        onNavigate={(c) => setAt(c.name)} />
      <Breadcrumb path={LONG_PATH} kindLabel={(k) => KIND_LABEL[k]} maxItems={3} onNavigate={(c) => setAt(c.name)} />
      <p className="gal-note">누른 위치: {at}</p>
      <div className="gal-frame">
        <PageHeader title="모델" description="사용자 앱 모델 목록에 무엇을 보일지 정해요." meta={<Badge size="sm">준비 중</Badge>}
          breadcrumb={<Breadcrumb path={SCOPE_PATH.slice(0, 2)} kindLabel={(k) => KIND_LABEL[k]} />}
          actions={<><Button icon="refresh">동기화</Button><Button variant="primary" icon="plus">추가</Button></>} divider />
        <Toolbar label="모델 거르개">
          <Input size="sm" type="search" icon="search" placeholder="검색" aria-label="검색" />
          <Chip selected icon={<ProviderIcon provider="anthropic" size="sm" />}>Anthropic</Chip>
          <ToolbarSpacer />
          <Segmented size="sm" label="상태" value="all" onChange={() => undefined} options={[{ value: 'all', label: '전체' }, { value: 'on', label: '노출' }]} />
        </Toolbar>
      </div>
    </Sec>
  );
}

/* 아이콘 */
function Icons() {
  return (
    <Sec title={COPY.sections.icons}>
      <div className="gal-icons">
        {ICON_NAMES.map((n) => (
          <span key={n} className="gal-icon" title={n}><Icon name={n} /><code>{n}</code></span>
        ))}
      </div>
      <div className="gal-icons">
        {PROVIDER_IDS.map((p) => (
          <span key={p} className="gal-icon" title={p}><ProviderIcon provider={p} size="lg" /><code>{p}</code></span>
        ))}
      </div>
      {/* 모델 기능 = 관리자 모델 표의 '기능' 칸 (아이콘 + 툴팁 · 한 색) */}
      <div className="gal-icons">
        {MODEL_CAPS.map((c) => (
          <span key={c.icon} className="gal-icon" title={c.label}><Icon name={c.icon} label={c.label} /><code>{c.label}</code></span>
        ))}
      </div>
    </Sec>
  );
}

/* 기다림 */
function Wait() {
  return (
    <Sec title={COPY.sections.wait}>
      <Row label="고리">
        <Spinner size="xs" />
        <Spinner />
        <Spinner size="md" label="불러오는 중" />
      </Row>
      <Skeleton lines={3} />
      <Skeleton width="50%" height={28} radius="pill" />
    </Sec>
  );
}
