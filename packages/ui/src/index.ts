// Design system entrypoint. Every app surface should import its primitives from here.
export { tokens, globalStyles, GlobalStyles, GLOBAL_STYLE_ID, cx } from './theme';

export { Stack, Inline, Grid, Container } from './primitives';
export type { StackProps, InlineProps, GridProps } from './primitives';

export { Button } from './Button';
export type { ButtonProps, ButtonVariant, ButtonSize } from './Button';

export { Input } from './Input';
export type { InputProps } from './Input';
export { Select, Textarea, Checkbox } from './forms';
export type { SelectProps, TextareaProps, CheckboxProps } from './forms';

export { Card, CardHeader, CardBody, CardFooter, Divider } from './Card';

export { Badge, statusTone } from './Badge';
export type { BadgeProps, BadgeTone } from './Badge';

export { Spinner, Skeleton, SkeletonText, EmptyState, ErrorState, StatCard } from './feedback';
export type { EmptyStateProps, ErrorStateProps, StatCardProps } from './feedback';

export { Modal } from './Modal';
export type { ModalProps } from './Modal';

export { ToastProvider, useToast } from './toast';
export type { ToastOptions, ToastVariant } from './toast';

export { ConfirmProvider, useConfirm } from './confirm';
export type { ConfirmOptions } from './confirm';

export { Breadcrumbs, PageHeader, Tabs, Pagination } from './navigation';
export type { Crumb, PageHeaderProps, TabItem, PaginationProps } from './navigation';

export { DataTable, TableToolbar, BulkActionBar } from './DataTable';
export type { Column, SortState, DataTableProps } from './DataTable';

export {
  required,
  email,
  minLength,
  maxLength,
  pattern,
  numeric,
  runValidators,
  validateFields,
} from './validators';
export type { Validator, FieldRules, FieldErrors } from './validators';
