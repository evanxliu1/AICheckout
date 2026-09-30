// Helios Table: https://helios.hashicorp.design/components/table/table
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icon';
import { cx } from './cx';

export type SortDirection = 'ascending' | 'descending';
export type TableSort = { key: string; direction: SortDirection };
export type TableColumn<Row> = {
  key: string;
  label: ReactNode;
  /** Plain-text label used in the sort announcement when `label` is not a string. */
  sortLabel?: string;
  align?: 'left' | 'right';
  /** Renders the cell as `<th scope="row">`; use for the column that names each row. */
  isRowHeader?: boolean;
  /** Provide to make the column sortable. */
  sortValue?: (row: Row) => string | number;
  render: (row: Row) => ReactNode;
};

export type TableProps<Row> = {
  /** Every table needs a caption; hide it visually when a heading already names the table. */
  caption: ReactNode;
  isCaptionHidden?: boolean;
  columns: TableColumn<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  density?: 'short' | 'medium' | 'tall';
  isStriped?: boolean;
  initialSort?: TableSort;
  className?: string;
};

export function Table<Row>({
  caption,
  isCaptionHidden,
  columns,
  rows,
  rowKey,
  density = 'medium',
  isStriped,
  initialSort,
  className,
}: TableProps<Row>) {
  const [sort, setSort] = useState<TableSort | undefined>(initialSort);
  const captionId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollable, setScrollable] = useState(false);
  // When the table is wider than its container, the wrapper scrolls and becomes a focusable,
  // labelled region so keyboard users can scroll it too.
  useEffect(() => {
    const node = scrollRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const update = () => setScrollable(node.scrollWidth > node.clientWidth);
    const observer = new ResizeObserver(update);
    observer.observe(node);
    if (node.firstElementChild) observer.observe(node.firstElementChild);
    update();
    return () => observer.disconnect();
  }, []);
  const sortColumn = sort && columns.find((column) => column.key === sort.key && column.sortValue);
  const sortedRows = useMemo(() => {
    if (!sort || !sortColumn?.sortValue) return rows;
    const value = sortColumn.sortValue;
    const factor = sort.direction === 'ascending' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const left = value(a),
        right = value(b);
      const order =
        typeof left === 'number' && typeof right === 'number'
          ? left - right
          : String(left).localeCompare(String(right));
      return order * factor;
    });
  }, [rows, sort, sortColumn]);

  const toggle = (key: string) =>
    setSort((current) => ({
      key,
      direction: current?.key === key && current.direction === 'ascending' ? 'descending' : 'ascending',
    }));

  const sortLabel =
    sortColumn &&
    (sortColumn.sortLabel ?? (typeof sortColumn.label === 'string' ? sortColumn.label : sort?.key));
  return (
    <div
      ref={scrollRef}
      className="ac-table-scroll"
      {...(scrollable ? { tabIndex: 0, role: 'region', 'aria-labelledby': captionId } : {})}
    >
      <table
        className={cx(
          'ac-table',
          `ac-table--density-${density}`,
          isStriped && 'ac-table--striped',
          className,
        )}
      >
        <caption id={captionId} className={isCaptionHidden ? 'ac-visually-hidden' : 'ac-table__caption'}>
          {caption}
          {sortColumn && sort ? (
            <span className="ac-visually-hidden">
              , sorted by {sortLabel} {sort.direction}
            </span>
          ) : null}
        </caption>
        <thead className="ac-table__thead">
          <tr>
            {columns.map((column) => {
              const active = sort?.key === column.key && Boolean(column.sortValue);
              return (
                <th
                  key={column.key}
                  scope="col"
                  className={cx('ac-table__th', column.align === 'right' && 'ac-table__cell--right')}
                  aria-sort={active ? sort?.direction : undefined}
                >
                  {column.sortValue ? (
                    <button
                      type="button"
                      className="ac-table__sort-button"
                      onClick={() => toggle(column.key)}
                    >
                      <span>{column.label}</span>
                      <Icon
                        name={
                          !active
                            ? 'swap-vertical'
                            : sort?.direction === 'ascending'
                              ? 'arrow-up'
                              : 'arrow-down'
                        }
                      />
                    </button>
                  ) : (
                    column.label
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="ac-table__tbody">
          {sortedRows.map((row) => (
            <tr key={rowKey(row)} className="ac-table__tr">
              {columns.map((column) => {
                const Cell = column.isRowHeader ? 'th' : 'td';
                return (
                  <Cell
                    key={column.key}
                    scope={column.isRowHeader ? 'row' : undefined}
                    className={cx('ac-table__td', column.align === 'right' && 'ac-table__cell--right')}
                  >
                    {column.render(row)}
                  </Cell>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
