import {createInventory} from "../../lib/host/inventory.js";
const [directory, prefix, count] = process.argv.slice(2);
const now = Date.parse("2026-09-14T10:00:00+08:00");
const wallet = createInventory({directory, now:() => now});
try {
  for (let i = 0; i < Number(count); i++) await wallet.observe({id:prefix + i, snapshotEvents:() => [
    {type:"request/header", data:{header:{config:{provider:"deepseek",model:"deepseek-flash"}}}},
    {type:"assistant/message", seq:1, time:now + 1, data:{turn:1,step:1,usage:{inputTokens:1000,outputTokens:100}}},
  ]});
} finally {await wallet.dispose();}
