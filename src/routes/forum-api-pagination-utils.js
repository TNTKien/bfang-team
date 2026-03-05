const createForumApiPaginationUtils = () => {
  const toPositiveInt = (value, fallback = 1) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return Math.max(1, Number(fallback) || 1);
    return Math.floor(numeric);
  };

  const buildPaginationState = ({ perPage, requestedPage, total }) => {
    const safePerPage = Math.max(1, toPositiveInt(perPage, 1));
    const safeTotal = Math.max(0, Number(total) || 0);
    const pageCount = Math.max(1, Math.ceil(safeTotal / safePerPage));
    const page = Math.min(Math.max(toPositiveInt(requestedPage, 1), 1), pageCount);
    const offset = (page - 1) * safePerPage;

    return {
      offset,
      page,
      pageCount,
      perPage: safePerPage,
      total: safeTotal,
    };
  };

  const buildPaginationPayload = ({ page, pageCount, perPage, total }) => ({
    page,
    perPage,
    total,
    pageCount,
    hasPrev: page > 1,
    hasNext: page < pageCount,
  });

  return {
    buildPaginationPayload,
    buildPaginationState,
  };
};

module.exports = createForumApiPaginationUtils;
