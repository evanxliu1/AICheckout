import { Table } from '@ai-checkout/ui';
import type { ChangeRow } from './comparison';

/** Published vs proposed values, one row per changed field. */
export default function ChangesTable({ rows, caption }: { rows: ChangeRow[]; caption: string }) {
  return (
    <Table
      caption={caption}
      isCaptionHidden
      className="changes-table"
      density="short"
      rowKey={(row) => row.key}
      rows={rows}
      columns={[
        { key: 'field', label: 'Field', isRowHeader: true, render: (row) => row.label },
        { key: 'before', label: 'Published', render: (row) => row.before },
        { key: 'after', label: 'Proposed', render: (row) => <strong>{row.after}</strong> },
      ]}
    />
  );
}
