export default {
  /** @brief 外部統計APIを使わないテストでは明示的に利用不能を返す */
  fetch() {
    return Response.json({ error: "Analytics service unavailable in this test" }, { status: 503 });
  },
};
