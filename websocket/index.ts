// 目前 WebSocket 的 send 方法是不支持回调函数的，所以无法得知写入的数据何时被底层消费掉了
// 如果快速地写入大量数据，会导致内存占用过高，这里封装了一个异步的 socketReady 方法
// 通过轮训 bufferedAmount 属性来判断是否可以安全的调用 send 方法，但这不是一个优雅的解决方案
// 如果有类似 Node.js 可写流的 "drain" 事件就好了，我尝试通过 Object.defineProperty 定义一个 bufferedAmount 的 setter
// 但是无论是定义在 WebSocket 实例上还是原形链上都不会触发，所以暂时只能这样的，等后面 WebSocketStream 正式发布就好了，那时候才能比较完美的支持背压
async function socketReady(socket: WebSocket) {
  if (socket.bufferedAmount === 0) {
    return;
  }
  await new Promise((r) => setTimeout(r, 0));
  return socketReady(socket);
}

// 用于创建一个可以快速产生数据的可读流，到达给定的时间后就结束
function createReadableStream(second: number) {
  const millisecond = second * 1000;
  let start = 0;
  return new ReadableStream({
    pull(controller) {
      if (start === 0) {
        start = Date.now();
      }
      if (Date.now() - start > millisecond) {
        controller.close();
        return;
      }
      controller.enqueue(new Uint8Array(65536));
    },
  });
}

Deno.serve((req) => {
  if (req.headers.get("upgrade") != "websocket") {
    return new Response(
      Deno.readFileSync(new URL("./index.html", import.meta.url))
    );
  }

  const path = new URL(req.url).pathname;
  console.log(path);

  if (path === "/download") {
    const { socket, response } = Deno.upgradeWebSocket(req);
    socket.onopen = async () => {
      try {
        const source = createReadableStream(10);
        console.time();
        for await (const chunk of source) {
          socket.send(chunk);
          await socketReady(socket);
        }
        console.timeEnd();
      } catch (error) {
        console.log("Error: ", error);
      } finally {
        socket.close();
      }
    };
    return response;
  }

  if (path === "/upload") {
    const { socket, response } = Deno.upgradeWebSocket(req);
    socket.binaryType = "arraybuffer";
    socket.onopen = () => {
      const start = Date.now();
      let receivedTotal = 0;
      socket.onmessage = (ev) => {
        receivedTotal += ev.data.byteLength;
      };
      socket.onclose = () => {
        console.log(receivedTotal, Date.now() - start);
      };
    };
    return response;
  }

  if (path === "/latency") {
    const { socket, response } = Deno.upgradeWebSocket(req);
    socket.onmessage = (ev) => {
      socket.send(ev.data);
    };
    return response;
  }

  return new Response(null, { status: 501 });
});
