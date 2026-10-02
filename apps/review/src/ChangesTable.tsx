import { useMemo, useState } from 'react';
import { Field, Table, TextInput } from '@ai-checkout/ui';
import type { ChangeRow } from './comparison';
import LazyDisclosure from './LazyDisclosure';

/** Up to this many changed fields are listed in one table; more are grouped by card and section. */
export const FLAT_CHANGE_LIMIT = 40;

function RowsTable({ rows, caption }: { rows: ChangeRow[]; caption: string }) {
  return (
    <div className="table-scroll">
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
    </div>
  );
}

/**
 * Published vs proposed values, one row per changed field. A large diff (a new 180-card catalog
 * changes tens of thousands of fields) is split into collapsed sections, one per card plus the
 * catalog, merchants, programs, brands, questions and sources, with a search over section names
 * and field labels. A section's table is rendered only when it is opened.
 */
export default function ChangesTable({
  rows,
  caption,
  idPrefix = 'changes',
}: {
  rows: ChangeRow[];
  caption: string;
  /** Distinguishes the search field when two change lists are on the page. */
  idPrefix?: string;
}) {
  const [query, setQuery] = useState('');
  const groups = useMemo(() => {
    const map = new Map<string, { label: string; rows: ChangeRow[] }>();
    for (const row of rows) {
      const group = map.get(row.group) ?? { label: row.groupLabel, rows: [] };
      group.rows.push(row);
      map.set(row.group, group);
    }
    return [...map.entries()].map(([id, group]) => ({ id, ...group }));
  }, [rows]);
  if (rows.length <= FLAT_CHANGE_LIMIT) return <RowsTable rows={rows} caption={caption} />;
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? groups.filter(
        (group) =>
          group.label.toLowerCase().includes(needle) ||
          group.id.toLowerCase().includes(needle) ||
          group.rows.some((row) => row.label.toLowerCase().includes(needle)),
      )
    : groups;
  return (
    <div className="stack-tight">
      <Field
        id={`${idPrefix}-search`}
        label="Find a card or section"
        helperText={`${rows.length.toLocaleString('en-US')} changed fields in ${groups.length} sections. Search by card name, ID or field.`}
      >
        {(control) => (
          <TextInput {...control} type="search" value={query} onChange={(e) => setQuery(e.target.value)} />
        )}
      </Field>
      <p className="small muted" role="status">
        {needle ? `${shown.length} of ${groups.length} sections match.` : ''}
      </p>
      <ul className="change-groups">
        {shown.map((group) => (
          <li key={group.id}>
            <LazyDisclosure
              title={`${group.label} (${group.rows.length} changed field${group.rows.length === 1 ? '' : 's'})`}
              className="change-group"
            >
              {() => <RowsTable rows={group.rows} caption={`${caption}: ${group.label}`} />}
            </LazyDisclosure>
          </li>
        ))}
      </ul>
    </div>
  );
}
