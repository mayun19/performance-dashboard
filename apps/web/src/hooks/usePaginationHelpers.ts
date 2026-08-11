import { PaginationPropsList } from "@/lib/types";
import { useMemo } from "react";

// Turunkan helper navigasi/indeks dari pagination meta manapun (KM, KPI Master, dst) —
// dipakai bersama komponen <Pagination>. `setCurrentPage` datang dari state pemanggil
// (per-tab/per-tabel), bukan dikelola di sini, supaya beberapa tabel di halaman yang sama
// bisa punya halaman berjalan masing-masing tanpa saling bentrok.
export function usePaginationHelpers(
  pagination: PaginationPropsList,
  currentPage: number,
  setCurrentPage: (page: number) => void,
) {
  const paginate = (page: number) => {
    if (page < 1 || page > pagination.totalPage) return;
    setCurrentPage(page);
  };

  const indexOfFirstProject = useMemo(
    () =>
      pagination.totalData === 0
        ? 0
        : (currentPage - 1) * pagination.perPage + 1,
    [currentPage, pagination.perPage, pagination.totalData],
  );

  const indexOfLastProject = useMemo(
    () => Math.min(currentPage * pagination.perPage, pagination.totalData),
    [currentPage, pagination.perPage, pagination.totalData],
  );

  return { paginate, indexOfFirstProject, indexOfLastProject };
}
