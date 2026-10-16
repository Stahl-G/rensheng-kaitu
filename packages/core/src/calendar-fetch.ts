import { fetchPublicResource } from "./public-fetch.js";

export async function fetchCalendar(
  address: string,
  transport?: Parameters<typeof fetchPublicResource>[2],
): Promise<Buffer> {
  return (await fetchPublicResource(address, { label: "日历订阅" }, transport)).data;
}
