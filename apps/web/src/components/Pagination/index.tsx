/**
 * Page => halaman saat ini
 * From => untuk label dibawah halaman
 * To => untuk label yang dituju
 * Total_Page => Jumlah Halaman
 * Current => Halaman Saat Ini
 * Per_Page => Halaman yang hendak ditampilkan
 */

import PaginationProps from "@/lib/types";
import Button from "../Button";

const Pagination = (props: PaginationProps) => {
  const renderPaginationButtons = (start: number, end: number) => {
    return Array.from({ length: end - start + 1 }, (_, index) => {
      const pageNumber = start + index;
      const isActive = props.currentPage === pageNumber;

      return (
        <Button
          key={pageNumber}
          data-testid={`pagination-btn-${pageNumber}`}
          onClick={() => props.paginate(pageNumber)}
          variant={isActive ? "primary-blue" : "primary-grey"}
          style={{
            minWidth: 32,
            fontWeight: 700,
          }}>
          {pageNumber}
        </Button>
      );
    });
  };

  const renderEllipsis = (key: string) => (
    <span
      key={key}
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "0 var(--space-2)",
        fontSize: "var(--text-md)",
        fontWeight: 600,
        color: "var(--color-text-muted)",
      }}>
      …
    </span>
  );

  const renderPaginationWithEllipsis = () => {
    const totalPages = props.page.total_page;
    const currentPage = props.currentPage;

    if (totalPages <= 5) {
      // If 5 or fewer pages, show all pages
      return renderPaginationButtons(1, totalPages);
    }

    // Check if current page is in the first 2 or last 2 pages
    const isCurrentInStart = currentPage <= 2;
    const isCurrentInEnd = currentPage >= totalPages - 1;

    if (isCurrentInStart) {
      return (
        <>
          {renderPaginationButtons(1, Math.min(2, totalPages))}
          {renderEllipsis("start")}
          {renderPaginationButtons(totalPages - 1, totalPages)}
        </>
      );
    } else if (isCurrentInEnd) {
      return (
        <>
          {renderPaginationButtons(1, 2)}
          {renderEllipsis("end")}
          {renderPaginationButtons(totalPages - 1, totalPages)}
        </>
      );
    } else {
      // Current page is in the middle, show sliding window
      const start = Math.max(1, currentPage - 1);
      const end = Math.min(totalPages, currentPage + 1);

      return (
        <>
          {start > 1 && (
            <>
              {renderPaginationButtons(1, 1)}
              {renderEllipsis("mid-start")}
            </>
          )}
          {renderPaginationButtons(start, end)}
          {end < totalPages && (
            <>
              {renderEllipsis("mid-end")}
              {renderPaginationButtons(totalPages, totalPages)}
            </>
          )}
        </>
      );
    }
  };

  return (
    <div
      className={props.parentClasses}
      style={{
        display: props.masterData ? "flex" : "block",
        width: props.masterData ? "auto" : "100%",
        marginTop: "var(--space-4)",
        marginBottom: "var(--space-4)",
      }}>
      <nav
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "var(--space-2)",
        }}>
        {!props?.masterData && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
            }}>
            <p
              style={{
                fontSize: "var(--text-sm)",
                color: "var(--color-text-muted)",
                margin: 0,
              }}>
              Menampilkan {props.indexOfFirstProject} sampai{" "}
              {props.indexOfLastProject} dari {props.page.total}{" "}
              {props?.masterData ? "entries" : props.customText || "proyek"}
            </p>
          </div>
        )}

        {props.page.total_page > 0 && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-2)",
            }}>
            <Button
              onClick={() => props.paginate(props.currentPage - 1)}
              disabled={props.currentPage === 1}
              variant="primary-grey">
              Sebelumnya
            </Button>

            <nav
              aria-label="Pagination"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-2)",
              }}>
              {props.page.total_page > 5
                ? renderPaginationWithEllipsis()
                : renderPaginationButtons(1, Math.min(props.page.total_page))}
            </nav>

            <Button
              onClick={() => props.paginate(props.currentPage + 1)}
              disabled={props.currentPage === props.page.total_page}
              variant="primary-grey">
              Selanjutnya
            </Button>
          </div>
        )}
      </nav>
    </div>
  );
};

export default Pagination;
