// @brewai/ui — 데스크톱 · 관리자 콘솔 공용 부품 (ADR-0012). 부품은 그리기만 한다: prop 으로 받고 이벤트로 알린다 (데이터 요청 없음).
// CSS 는 앱 시작점에서 한 번: import '@brewai/ui/styles.css' (토큰 + 기본 + 부품). 클래스 = ui-* · 변형 = data-*.
export { cx, flag } from './cx';
export { UI_COPY } from './copy';
export {
  LEVELS, KIND_LABEL, kindLabel, kindIcon, kindOf, roleLabel, roleIcon, visiblePath, crumbOf, pathOf, parsePath,
  type ScopeCrumb, type ScopePath, type ScopeLevel, type LevelRole,
} from './scope';
export { Icon, Mark, ICON_NAMES, MARK_PATH, renderIcon, type IconLike, type IconName, type IconSize } from './icons';
export { ProviderIcon, PROVIDER_IDS, providerId, providerLabel, providerRank, type ProviderId } from './providers';
export { Spinner, Skeleton } from './spinner';
export { Button, LinkButton, IconButton, type ButtonProps, type ButtonVariant, type ControlSize, type IconButtonProps, type LinkButtonProps } from './button';
export { Field, useFieldControl, type FieldProps } from './field';
export {
  Input, PasswordInput, Textarea, Checkbox, Radio, Switch, Segmented, passwordStrength,
  type InputProps, type InputSize, type PasswordInputProps, type TextareaProps, type CheckboxProps, type RadioProps, type SwitchProps,
  type SegmentedProps, type SegmentedOption, type StrengthLevel,
} from './inputs';
export { Select, type SelectProps, type SelectOption } from './select';
export {
  Popover, Menu, Dialog, Sheet, Tooltip,
  type PopoverProps, type MenuProps, type MenuEntry, type DialogProps, type SheetProps, type TriggerProps, type Placement, type Surface,
} from './overlays';
export { Toast, ToastRegion, useToastQueue, type ToastItem } from './toast';
export {
  Badge, Chip, StatusDot, Avatar, Kbd, Card, CardHeader, StatCard, Callout, KeyValue, EmptyState, Meta, initialsOf,
  type Tone, type DotState, type BadgeProps, type ChipProps, type CardProps, type StatCardProps, type CalloutProps, type KeyValueItem, type EmptyStateProps, type MetaProps,
} from './display';
export { Table, TableFrame, type Column, type TableProps, type SortState, type SortDir } from './table';
export { Tabs, Breadcrumb, PageHeader, Toolbar, ToolbarSpacer, type TabItem, type TabsProps, type BreadcrumbProps, type PageHeaderProps } from './navigation';
