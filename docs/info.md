
 pm2 logs asas-backend --lines 300
[TAILING] Tailing last 300 lines for [asas-backend] process (change the value with --lines option)
/root/.pm2/logs/asas-backend-error.log last 300 lines:
2|asas-bac |     at HTTPParser.parserOnIncomingClient (node:_http_client:716:27)
2|asas-bac |     at HTTPParser.parserOnHeadersComplete (node:_http_common:117:17)
2|asas-bac |     at TLSSocket.socketOnData (node:_http_client:558:22)
2|asas-bac |     at TLSSocket.emit (node:events:519:28)
2|asas-bac |     at addChunk (node:internal/streams/readable:561:12)
2|asas-bac |     at readableAddChunkPushByteMode (node:internal/streams/readable:512:3)
2|asas-bac |     at TLSSocket.Readable.push (node:internal/streams/readable:392:5)
2|asas-bac | [Nest] 3387683  - 07/24/2026, 5:07:00 PM   ERROR [PlatformMediaFromUrlService] Failed to download from URL: https://upload.wikimedia.org/wikipedia/commons/e/e0/Thermite_reaction.png
2|asas-bac | [Nest] 3387683  - 07/24/2026, 5:07:00 PM   ERROR [PlatformMediaFromUrlService] Error: HTTP 404
2|asas-bac |     at ClientRequest.<anonymous> (/www/node-projects/asas-backend/src/platform/media/platform-media-from-url.service.ts:274:24)
2|asas-bac |     at Object.onceWrapper (node:events:634:26)
2|asas-bac |     at ClientRequest.emit (node:events:519:28)
2|asas-bac |     at HTTPParser.parserOnIncomingClient (node:_http_client:716:27)
2|asas-bac |     at HTTPParser.parserOnHeadersComplete (node:_http_common:117:17)
2|asas-bac |     at TLSSocket.socketOnData (node:_http_client:558:22)
2|asas-bac |     at TLSSocket.emit (node:events:519:28)
2|asas-bac |     at addChunk (node:internal/streams/readable:561:12)
2|asas-bac |     at readableAddChunkPushByteMode (node:internal/streams/readable:512:3)
2|asas-bac |     at TLSSocket.Readable.push (node:internal/streams/readable:392:5)
2|asas-bac | [Nest] 3387683  - 07/24/2026, 5:07:02 PM   ERROR [PlatformMediaFromUrlService] Failed to download from URL: https://upload.wikimedia.org/wikipedia/commons/e/e0/Thermite_reaction.png
2|asas-bac | [Nest] 3387683  - 07/24/2026, 5:07:02 PM   ERROR [PlatformMediaFromUrlService] Error: HTTP 404
2|asas-bac |     at ClientRequest.<anonymous> (/www/node-projects/asas-backend/src/platform/media/platform-media-from-url.service.ts:274:24)
2|asas-bac |     at Object.onceWrapper (node:events:634:26)
2|asas-bac |     at ClientRequest.emit (node:events:519:28)
2|asas-bac |     at HTTPParser.parserOnIncomingClient (node:_http_client:716:27)
2|asas-bac |     at HTTPParser.parserOnHeadersComplete (node:_http_common:117:17)
2|asas-bac |     at TLSSocket.socketOnData (node:_http_client:558:22)
2|asas-bac |     at TLSSocket.emit (node:events:519:28)
2|asas-bac |     at addChunk (node:internal/streams/readable:561:12)
2|asas-bac |     at readableAddChunkPushByteMode (node:internal/streams/readable:512:3)
2|asas-bac |     at TLSSocket.Readable.push (node:internal/streams/readable:392:5)
2|asas-bac | [Nest] 3387683  - 07/24/2026, 5:09:06 PM   ERROR [PlatformMediaFromUrlService] Failed to download from URL: https://upload.wikimedia.org/wikipedia/commons/b/b3/Hall-heroult-process.png
2|asas-bac | [Nest] 3387683  - 07/24/2026, 5:09:06 PM   ERROR [PlatformMediaFromUrlService] Error: HTTP 404
2|asas-bac |     at ClientRequest.<anonymous> (/www/node-projects/asas-backend/src/platform/media/platform-media-from-url.service.ts:274:24)
2|asas-bac |     at Object.onceWrapper (node:events:634:26)
2|asas-bac |     at ClientRequest.emit (node:events:519:28)
2|asas-bac |     at HTTPParser.parserOnIncomingClient (node:_http_client:716:27)
2|asas-bac |     at HTTPParser.parserOnHeadersComplete (node:_http_common:117:17)
2|asas-bac |     at TLSSocket.socketOnData (node:_http_client:558:22)
2|asas-bac |     at TLSSocket.emit (node:events:519:28)
2|asas-bac |     at addChunk (node:internal/streams/readable:561:12)
2|asas-bac |     at readableAddChunkPushByteMode (node:internal/streams/readable:512:3)
2|asas-bac |     at TLSSocket.Readable.push (node:internal/streams/readable:392:5)
2|asas-bac | [Nest] 3387683  - 07/24/2026, 5:09:08 PM   ERROR [PlatformMediaFromUrlService] Failed to download from URL: https://upload.wikimedia.org/wikipedia/commons/b/b3/Hall-heroult-process.png
2|asas-bac | [Nest] 3387683  - 07/24/2026, 5:09:08 PM   ERROR [PlatformMediaFromUrlService] Error: HTTP 404
2|asas-bac |     at ClientRequest.<anonymous> (/www/node-projects/asas-backend/src/platform/media/platform-media-from-url.service.ts:274:24)
2|asas-bac |     at Object.onceWrapper (node:events:634:26)
2|asas-bac |     at ClientRequest.emit (node:events:519:28)
2|asas-bac |     at HTTPParser.parserOnIncomingClient (node:_http_client:716:27)
2|asas-bac |     at HTTPParser.parserOnHeadersComplete (node:_http_common:117:17)
2|asas-bac |     at TLSSocket.socketOnData (node:_http_client:558:22)
2|asas-bac |     at TLSSocket.emit (node:events:519:28)
2|asas-bac |     at addChunk (node:internal/streams/readable:561:12)
2|asas-bac |     at readableAddChunkPushByteMode (node:internal/streams/readable:512:3)
2|asas-bac |     at TLSSocket.Readable.push (node:internal/streams/readable:392:5)
2|asas-bac | [Nest] 3387683  - 07/24/2026, 5:09:09 PM   ERROR [PlatformMediaFromUrlService] Failed to download from URL: https://upload.wikimedia.org/wikipedia/commons/e/e0/Thermite_reaction.png
2|asas-bac | [Nest] 3387683  - 07/24/2026, 5:09:09 PM   ERROR [PlatformMediaFromUrlService] Error: HTTP 404
2|asas-bac |     at ClientRequest.<anonymous> (/www/node-projects/asas-backend/src/platform/media/platform-media-from-url.service.ts:274:24)
2|asas-bac |     at Object.onceWrapper (node:events:634:26)
2|asas-bac |     at ClientRequest.emit (node:events:519:28)
2|asas-bac |     at HTTPParser.parserOnIncomingClient (node:_http_client:716:27)
2|asas-bac |     at HTTPParser.parserOnHeadersComplete (node:_http_common:117:17)
2|asas-bac |     at TLSSocket.socketOnData (node:_http_client:558:22)
2|asas-bac |     at TLSSocket.emit (node:events:519:28)
2|asas-bac |     at addChunk (node:internal/streams/readable:561:12)
2|asas-bac |     at readableAddChunkPushByteMode (node:internal/streams/readable:512:3)
2|asas-bac |     at TLSSocket.Readable.push (node:internal/streams/readable:392:5)
2|asas-bac | [Nest] 3387683  - 07/24/2026, 5:09:11 PM   ERROR [PlatformMediaFromUrlService] Failed to download from URL: https://upload.wikimedia.org/wikipedia/commons/e/e0/Thermite_reaction.png
2|asas-bac | [Nest] 3387683  - 07/24/2026, 5:09:11 PM   ERROR [PlatformMediaFromUrlService] Error: HTTP 404
2|asas-bac |     at ClientRequest.<anonymous> (/www/node-projects/asas-backend/src/platform/media/platform-media-from-url.service.ts:274:24)
2|asas-bac |     at Object.onceWrapper (node:events:634:26)
2|asas-bac |     at ClientRequest.emit (node:events:519:28)
2|asas-bac |     at HTTPParser.parserOnIncomingClient (node:_http_client:716:27)
2|asas-bac |     at HTTPParser.parserOnHeadersComplete (node:_http_common:117:17)
2|asas-bac |     at TLSSocket.socketOnData (node:_http_client:558:22)
2|asas-bac |     at TLSSocket.emit (node:events:519:28)
2|asas-bac |     at addChunk (node:internal/streams/readable:561:12)
2|asas-bac |     at readableAddChunkPushByteMode (node:internal/streams/readable:512:3)
2|asas-bac |     at TLSSocket.Readable.push (node:internal/streams/readable:392:5)
2|asas-bac | [Nest] 3387683  - 07/26/2026, 7:50:08 PM   ERROR [PlatformMediaFromUrlService] Failed to download from URL: https://upload.wikimedia.org/wikipedia/commons/2/25/Madinah_Map_Before_Hijrah.png
2|asas-bac | [Nest] 3387683  - 07/26/2026, 7:50:08 PM   ERROR [PlatformMediaFromUrlService] Error: HTTP 404
2|asas-bac |     at ClientRequest.<anonymous> (/www/node-projects/asas-backend/src/platform/media/platform-media-from-url.service.ts:274:24)
2|asas-bac |     at Object.onceWrapper (node:events:634:26)
2|asas-bac |     at ClientRequest.emit (node:events:519:28)
2|asas-bac |     at HTTPParser.parserOnIncomingClient (node:_http_client:716:27)
2|asas-bac |     at HTTPParser.parserOnHeadersComplete (node:_http_common:117:17)
2|asas-bac |     at TLSSocket.socketOnData (node:_http_client:558:22)
2|asas-bac |     at TLSSocket.emit (node:events:519:28)
2|asas-bac |     at addChunk (node:internal/streams/readable:561:12)
2|asas-bac |     at readableAddChunkPushByteMode (node:internal/streams/readable:512:3)
2|asas-bac |     at TLSSocket.Readable.push (node:internal/streams/readable:392:5)
2|asas-bac | [Nest] 3387683  - 07/26/2026, 7:50:10 PM   ERROR [PlatformMediaFromUrlService] Failed to download from URL: https://upload.wikimedia.org/wikipedia/commons/2/25/Madinah_Map_Before_Hijrah.png
2|asas-bac | [Nest] 3387683  - 07/26/2026, 7:50:10 PM   ERROR [PlatformMediaFromUrlService] Error: HTTP 404
2|asas-bac |     at ClientRequest.<anonymous> (/www/node-projects/asas-backend/src/platform/media/platform-media-from-url.service.ts:274:24)
2|asas-bac |     at Object.onceWrapper (node:events:634:26)
2|asas-bac |     at ClientRequest.emit (node:events:519:28)
2|asas-bac |     at HTTPParser.parserOnIncomingClient (node:_http_client:716:27)
2|asas-bac |     at HTTPParser.parserOnHeadersComplete (node:_http_common:117:17)
2|asas-bac |     at TLSSocket.socketOnData (node:_http_client:558:22)
2|asas-bac |     at TLSSocket.emit (node:events:519:28)
2|asas-bac |     at addChunk (node:internal/streams/readable:561:12)
2|asas-bac |     at readableAddChunkPushByteMode (node:internal/streams/readable:512:3)
2|asas-bac |     at TLSSocket.Readable.push (node:internal/streams/readable:392:5)
2|asas-bac | [Nest] 3387683  - 07/26/2026, 7:55:29 PM   ERROR [PlatformMediaFromUrlService] Failed to download from URL: https://upload.wikimedia.org/wikipedia/commons/3/30/Al-Be%27ah_Mosque_Mina.jpg
2|asas-bac | [Nest] 3387683  - 07/26/2026, 7:55:29 PM   ERROR [PlatformMediaFromUrlService] Error: HTTP 404
2|asas-bac |     at ClientRequest.<anonymous> (/www/node-projects/asas-backend/src/platform/media/platform-media-from-url.service.ts:274:24)
2|asas-bac |     at Object.onceWrapper (node:events:634:26)
2|asas-bac |     at ClientRequest.emit (node:events:519:28)
2|asas-bac |     at HTTPParser.parserOnIncomingClient (node:_http_client:716:27)
2|asas-bac |     at HTTPParser.parserOnHeadersComplete (node:_http_common:117:17)
2|asas-bac |     at TLSSocket.socketOnData (node:_http_client:558:22)
2|asas-bac |     at TLSSocket.emit (node:events:519:28)
2|asas-bac |     at addChunk (node:internal/streams/readable:561:12)
2|asas-bac |     at readableAddChunkPushByteMode (node:internal/streams/readable:512:3)
2|asas-bac |     at TLSSocket.Readable.push (node:internal/streams/readable:392:5)
2|asas-bac | [Nest] 3387683  - 07/26/2026, 7:55:31 PM   ERROR [PlatformMediaFromUrlService] Failed to download from URL: https://upload.wikimedia.org/wikipedia/commons/3/30/Al-Be%27ah_Mosque_Mina.jpg
2|asas-bac | [Nest] 3387683  - 07/26/2026, 7:55:31 PM   ERROR [PlatformMediaFromUrlService] Error: HTTP 404
2|asas-bac |     at ClientRequest.<anonymous> (/www/node-projects/asas-backend/src/platform/media/platform-media-from-url.service.ts:274:24)
2|asas-bac |     at Object.onceWrapper (node:events:634:26)
2|asas-bac |     at ClientRequest.emit (node:events:519:28)
2|asas-bac |     at HTTPParser.parserOnIncomingClient (node:_http_client:716:27)
2|asas-bac |     at HTTPParser.parserOnHeadersComplete (node:_http_common:117:17)
2|asas-bac |     at TLSSocket.socketOnData (node:_http_client:558:22)
2|asas-bac |     at TLSSocket.emit (node:events:519:28)
2|asas-bac |     at addChunk (node:internal/streams/readable:561:12)
2|asas-bac |     at readableAddChunkPushByteMode (node:internal/streams/readable:512:3)
2|asas-bac |     at TLSSocket.Readable.push (node:internal/streams/readable:392:5)
2|asas-bac | [Nest] 3387683  - 07/26/2026, 8:02:47 PM   ERROR [PlatformMediaFromUrlService] Failed to download from URL: https://upload.wikimedia.org/wikipedia/commons/e/e0/Ghar_Thawr.jpg
2|asas-bac | [Nest] 3387683  - 07/26/2026, 8:02:47 PM   ERROR [PlatformMediaFromUrlService] Error: HTTP 404
2|asas-bac |     at ClientRequest.<anonymous> (/www/node-projects/asas-backend/src/platform/media/platform-media-from-url.service.ts:274:24)
2|asas-bac |     at Object.onceWrapper (node:events:634:26)
2|asas-bac |     at ClientRequest.emit (node:events:519:28)
2|asas-bac |     at HTTPParser.parserOnIncomingClient (node:_http_client:716:27)
2|asas-bac |     at HTTPParser.parserOnHeadersComplete (node:_http_common:117:17)
2|asas-bac |     at TLSSocket.socketOnData (node:_http_client:558:22)
2|asas-bac |     at TLSSocket.emit (node:events:519:28)
2|asas-bac |     at addChunk (node:internal/streams/readable:561:12)
2|asas-bac |     at readableAddChunkPushByteMode (node:internal/streams/readable:512:3)
2|asas-bac |     at TLSSocket.Readable.push (node:internal/streams/readable:392:5)
2|asas-bac | [Nest] 3387683  - 07/26/2026, 8:02:50 PM   ERROR [PlatformMediaFromUrlService] Failed to download from URL: https://upload.wikimedia.org/wikipedia/commons/e/e0/Ghar_Thawr.jpg
2|asas-bac | [Nest] 3387683  - 07/26/2026, 8:02:50 PM   ERROR [PlatformMediaFromUrlService] Error: HTTP 404
2|asas-bac |     at ClientRequest.<anonymous> (/www/node-projects/asas-backend/src/platform/media/platform-media-from-url.service.ts:274:24)
2|asas-bac |     at Object.onceWrapper (node:events:634:26)
2|asas-bac |     at ClientRequest.emit (node:events:519:28)
2|asas-bac |     at HTTPParser.parserOnIncomingClient (node:_http_client:716:27)
2|asas-bac |     at HTTPParser.parserOnHeadersComplete (node:_http_common:117:17)
2|asas-bac |     at TLSSocket.socketOnData (node:_http_client:558:22)
2|asas-bac |     at TLSSocket.emit (node:events:519:28)
2|asas-bac |     at addChunk (node:internal/streams/readable:561:12)
2|asas-bac |     at readableAddChunkPushByteMode (node:internal/streams/readable:512:3)
2|asas-bac |     at TLSSocket.Readable.push (node:internal/streams/readable:392:5)
2|asas-bac | [Nest] 3387683  - 07/26/2026, 8:14:00 PM   ERROR [PlatformMediaFromUrlService] Failed to download from URL: https://upload.wikimedia.org/wikipedia/commons/1/1a/Shibam_Wadi_Hadhramaut_Yemen.jpg
2|asas-bac | [Nest] 3387683  - 07/26/2026, 8:14:00 PM   ERROR [PlatformMediaFromUrlService] Error: HTTP 404
2|asas-bac |     at ClientRequest.<anonymous> (/www/node-projects/asas-backend/src/platform/media/platform-media-from-url.service.ts:274:24)
2|asas-bac |     at Object.onceWrapper (node:events:634:26)
2|asas-bac |     at ClientRequest.emit (node:events:519:28)
2|asas-bac |     at HTTPParser.parserOnIncomingClient (node:_http_client:716:27)
2|asas-bac |     at HTTPParser.parserOnHeadersComplete (node:_http_common:117:17)
2|asas-bac |     at TLSSocket.socketOnData (node:_http_client:558:22)
2|asas-bac |     at TLSSocket.emit (node:events:519:28)
2|asas-bac |     at addChunk (node:internal/streams/readable:561:12)
2|asas-bac |     at readableAddChunkPushByteMode (node:internal/streams/readable:512:3)
2|asas-bac |     at TLSSocket.Readable.push (node:internal/streams/readable:392:5)
2|asas-bac | [Nest] 3387683  - 07/26/2026, 8:14:03 PM   ERROR [PlatformMediaFromUrlService] Failed to download from URL: https://upload.wikimedia.org/wikipedia/commons/1/1a/Shibam_Wadi_Hadhramaut_Yemen.jpg
2|asas-bac | [Nest] 3387683  - 07/26/2026, 8:14:03 PM   ERROR [PlatformMediaFromUrlService] Error: HTTP 404
2|asas-bac |     at ClientRequest.<anonymous> (/www/node-projects/asas-backend/src/platform/media/platform-media-from-url.service.ts:274:24)
2|asas-bac |     at Object.onceWrapper (node:events:634:26)
2|asas-bac |     at ClientRequest.emit (node:events:519:28)
2|asas-bac |     at HTTPParser.parserOnIncomingClient (node:_http_client:716:27)
2|asas-bac |     at HTTPParser.parserOnHeadersComplete (node:_http_common:117:17)
2|asas-bac |     at TLSSocket.socketOnData (node:_http_client:558:22)
2|asas-bac |     at TLSSocket.emit (node:events:519:28)
2|asas-bac |     at addChunk (node:internal/streams/readable:561:12)
2|asas-bac |     at readableAddChunkPushByteMode (node:internal/streams/readable:512:3)
2|asas-bac |     at TLSSocket.Readable.push (node:internal/streams/readable:392:5)
2|asas-bac | [Nest] 3387683  - 07/26/2026, 8:14:04 PM   ERROR [PlatformMediaFromUrlService] Failed to download from URL: https://upload.wikimedia.org/wikipedia/commons/5/5e/Boswellia_sacra_-_01.jpg
2|asas-bac | [Nest] 3387683  - 07/26/2026, 8:14:04 PM   ERROR [PlatformMediaFromUrlService] Error: HTTP 404
2|asas-bac |     at ClientRequest.<anonymous> (/www/node-projects/asas-backend/src/platform/media/platform-media-from-url.service.ts:274:24)
2|asas-bac |     at Object.onceWrapper (node:events:634:26)
2|asas-bac |     at ClientRequest.emit (node:events:519:28)
2|asas-bac |     at HTTPParser.parserOnIncomingClient (node:_http_client:716:27)
2|asas-bac |     at HTTPParser.parserOnHeadersComplete (node:_http_common:117:17)
2|asas-bac |     at TLSSocket.socketOnData (node:_http_client:558:22)
2|asas-bac |     at TLSSocket.emit (node:events:519:28)
2|asas-bac |     at addChunk (node:internal/streams/readable:561:12)
2|asas-bac |     at readableAddChunkPushByteMode (node:internal/streams/readable:512:3)
2|asas-bac |     at TLSSocket.Readable.push (node:internal/streams/readable:392:5)
2|asas-bac | [Nest] 3387683  - 07/26/2026, 8:14:06 PM   ERROR [PlatformMediaFromUrlService] Failed to download from URL: https://upload.wikimedia.org/wikipedia/commons/5/5e/Boswellia_sacra_-_01.jpg
2|asas-bac | [Nest] 3387683  - 07/26/2026, 8:14:06 PM   ERROR [PlatformMediaFromUrlService] Error: HTTP 404
2|asas-bac |     at ClientRequest.<anonymous> (/www/node-projects/asas-backend/src/platform/media/platform-media-from-url.service.ts:274:24)
2|asas-bac |     at Object.onceWrapper (node:events:634:26)
2|asas-bac |     at ClientRequest.emit (node:events:519:28)
2|asas-bac |     at HTTPParser.parserOnIncomingClient (node:_http_client:716:27)
2|asas-bac |     at HTTPParser.parserOnHeadersComplete (node:_http_common:117:17)
2|asas-bac |     at TLSSocket.socketOnData (node:_http_client:558:22)
2|asas-bac |     at TLSSocket.emit (node:events:519:28)
2|asas-bac |     at addChunk (node:internal/streams/readable:561:12)
2|asas-bac |     at readableAddChunkPushByteMode (node:internal/streams/readable:512:3)
2|asas-bac |     at TLSSocket.Readable.push (node:internal/streams/readable:392:5)
2|asas-bac | [Nest] 3387683  - 07/26/2026, 8:16:41 PM   ERROR [PlatformMediaFromUrlService] Failed to download from URL: https://upload.wikimedia.org/wikipedia/commons/4/4e/Marib_Dam.jpg
2|asas-bac | [Nest] 3387683  - 07/26/2026, 8:16:41 PM   ERROR [PlatformMediaFromUrlService] Error: HTTP 404
2|asas-bac |     at ClientRequest.<anonymous> (/www/node-projects/asas-backend/src/platform/media/platform-media-from-url.service.ts:274:24)
2|asas-bac |     at Object.onceWrapper (node:events:634:26)
2|asas-bac |     at ClientRequest.emit (node:events:519:28)
2|asas-bac |     at HTTPParser.parserOnIncomingClient (node:_http_client:716:27)
2|asas-bac |     at HTTPParser.parserOnHeadersComplete (node:_http_common:117:17)
2|asas-bac |     at TLSSocket.socketOnData (node:_http_client:558:22)
2|asas-bac |     at TLSSocket.emit (node:events:519:28)
2|asas-bac |     at addChunk (node:internal/streams/readable:561:12)
2|asas-bac |     at readableAddChunkPushByteMode (node:internal/streams/readable:512:3)
2|asas-bac |     at TLSSocket.Readable.push (node:internal/streams/readable:392:5)
2|asas-bac | [Nest] 3387683  - 07/26/2026, 8:16:43 PM   ERROR [PlatformMediaFromUrlService] Failed to download from URL: https://upload.wikimedia.org/wikipedia/commons/4/4e/Marib_Dam.jpg
2|asas-bac | [Nest] 3387683  - 07/26/2026, 8:16:43 PM   ERROR [PlatformMediaFromUrlService] Error: HTTP 404
2|asas-bac |     at ClientRequest.<anonymous> (/www/node-projects/asas-backend/src/platform/media/platform-media-from-url.service.ts:274:24)
2|asas-bac |     at Object.onceWrapper (node:events:634:26)
2|asas-bac |     at ClientRequest.emit (node:events:519:28)
2|asas-bac |     at HTTPParser.parserOnIncomingClient (node:_http_client:716:27)
2|asas-bac |     at HTTPParser.parserOnHeadersComplete (node:_http_common:117:17)
2|asas-bac |     at TLSSocket.socketOnData (node:_http_client:558:22)
2|asas-bac |     at TLSSocket.emit (node:events:519:28)
2|asas-bac |     at addChunk (node:internal/streams/readable:561:12)
2|asas-bac |     at readableAddChunkPushByteMode (node:internal/streams/readable:512:3)
2|asas-bac |     at TLSSocket.Readable.push (node:internal/streams/readable:392:5)
2|asas-bac | [Nest] 3387683  - 07/27/2026, 3:51:50 AM   ERROR [PlatformMediaFromUrlService] Failed to download from URL: https://upload.wikimedia.org/wikipedia/commons/thumb/6/6f/Quran_script_Uthmanic.svg/800px-Quran_script_Uthmanic.svg.png
2|asas-bac | [Nest] 3387683  - 07/27/2026, 3:51:50 AM   ERROR [PlatformMediaFromUrlService] Error: HTTP 400
2|asas-bac |     at ClientRequest.<anonymous> (/www/node-projects/asas-backend/src/platform/media/platform-media-from-url.service.ts:274:24)
2|asas-bac |     at Object.onceWrapper (node:events:634:26)
2|asas-bac |     at ClientRequest.emit (node:events:519:28)
2|asas-bac |     at HTTPParser.parserOnIncomingClient (node:_http_client:716:27)
2|asas-bac |     at HTTPParser.parserOnHeadersComplete (node:_http_common:117:17)
2|asas-bac |     at TLSSocket.socketOnData (node:_http_client:558:22)
2|asas-bac |     at TLSSocket.emit (node:events:519:28)
2|asas-bac |     at addChunk (node:internal/streams/readable:561:12)
2|asas-bac |     at readableAddChunkPushByteMode (node:internal/streams/readable:512:3)
2|asas-bac |     at TLSSocket.Readable.push (node:internal/streams/readable:392:5)
2|asas-bac | [Nest] 3387683  - 07/27/2026, 3:51:52 AM   ERROR [PlatformMediaFromUrlService] Failed to download from URL: https://upload.wikimedia.org/wikipedia/commons/thumb/6/6f/Quran_script_Uthmanic.svg/800px-Quran_script_Uthmanic.svg.png
2|asas-bac | [Nest] 3387683  - 07/27/2026, 3:51:52 AM   ERROR [PlatformMediaFromUrlService] Error: HTTP 400
2|asas-bac |     at ClientRequest.<anonymous> (/www/node-projects/asas-backend/src/platform/media/platform-media-from-url.service.ts:274:24)
2|asas-bac |     at Object.onceWrapper (node:events:634:26)
2|asas-bac |     at ClientRequest.emit (node:events:519:28)
2|asas-bac |     at HTTPParser.parserOnIncomingClient (node:_http_client:716:27)
2|asas-bac |     at HTTPParser.parserOnHeadersComplete (node:_http_common:117:17)
2|asas-bac |     at TLSSocket.socketOnData (node:_http_client:558:22)
2|asas-bac |     at TLSSocket.emit (node:events:519:28)
2|asas-bac |     at addChunk (node:internal/streams/readable:561:12)
2|asas-bac |     at readableAddChunkPushByteMode (node:internal/streams/readable:512:3)
2|asas-bac |     at TLSSocket.Readable.push (node:internal/streams/readable:392:5)
2|asas-bac | [Nest] 3387683  - 07/28/2026, 12:51:16 PM   ERROR [PlatformMediaFromUrlService] Failed to download from URL: https://upload.wikimedia.org/wikipedia/commons/e/e3/Lebanon_Religions_Map.png
2|asas-bac | [Nest] 3387683  - 07/28/2026, 12:51:16 PM   ERROR [PlatformMediaFromUrlService] Error: HTTP 404
2|asas-bac |     at ClientRequest.<anonymous> (/www/node-projects/asas-backend/src/platform/media/platform-media-from-url.service.ts:274:24)
2|asas-bac |     at Object.onceWrapper (node:events:634:26)
2|asas-bac |     at ClientRequest.emit (node:events:519:28)
2|asas-bac |     at HTTPParser.parserOnIncomingClient (node:_http_client:716:27)
2|asas-bac |     at HTTPParser.parserOnHeadersComplete (node:_http_common:117:17)
2|asas-bac |     at TLSSocket.socketOnData (node:_http_client:558:22)
2|asas-bac |     at TLSSocket.emit (node:events:519:28)
2|asas-bac |     at addChunk (node:internal/streams/readable:561:12)
2|asas-bac |     at readableAddChunkPushByteMode (node:internal/streams/readable:512:3)
2|asas-bac |     at TLSSocket.Readable.push (node:internal/streams/readable:392:5)
2|asas-bac | [Nest] 3387683  - 07/28/2026, 12:51:18 PM   ERROR [PlatformMediaFromUrlService] Failed to download from URL: https://upload.wikimedia.org/wikipedia/commons/e/e3/Lebanon_Religions_Map.png
2|asas-bac | [Nest] 3387683  - 07/28/2026, 12:51:18 PM   ERROR [PlatformMediaFromUrlService] Error: HTTP 404
2|asas-bac |     at ClientRequest.<anonymous> (/www/node-projects/asas-backend/src/platform/media/platform-media-from-url.service.ts:274:24)
2|asas-bac |     at Object.onceWrapper (node:events:634:26)
2|asas-bac |     at ClientRequest.emit (node:events:519:28)
2|asas-bac |     at HTTPParser.parserOnIncomingClient (node:_http_client:716:27)
2|asas-bac |     at HTTPParser.parserOnHeadersComplete (node:_http_common:117:17)
2|asas-bac |     at TLSSocket.socketOnData (node:_http_client:558:22)
2|asas-bac |     at TLSSocket.emit (node:events:519:28)
2|asas-bac |     at addChunk (node:internal/streams/readable:561:12)
2|asas-bac |     at readableAddChunkPushByteMode (node:internal/streams/readable:512:3)
2|asas-bac |     at TLSSocket.Readable.push (node:internal/streams/readable:392:5)
2|asas-bac | [Nest] 3672644  - 07/28/2026, 2:11:46 PM   ERROR [ExceptionsHandler] PrismaClientKnownRequestError: 
2|asas-bac | Invalid `prisma.$queryRaw()` invocation:
2|asas-bac | 
2|asas-bac | 
2|asas-bac | Raw query failed. Code: `N/A`. Message: `Failed to deserialize column of type 'void'. If you're using $queryRaw and this column is explicitly marked as `Unsupported` in your Prisma schema, try casting this column to any supported Prisma type such as `String`.`
2|asas-bac |     at Mn.handleRequestError (/www/node-projects/asas-backend/node_modules/@prisma/client/runtime/library.js:121:7338)
2|asas-bac |     at Mn.handleAndLogRequestError (/www/node-projects/asas-backend/node_modules/@prisma/client/runtime/library.js:121:6663)
2|asas-bac |     at Mn.request (/www/node-projects/asas-backend/node_modules/@prisma/client/runtime/library.js:121:6370)
2|asas-bac |     at l (/www/node-projects/asas-backend/node_modules/@prisma/client/runtime/library.js:130:9633)
2|asas-bac |     at /www/node-projects/asas-backend/src/prisma/prisma.service.ts:15:22
2|asas-bac |     at /www/node-projects/asas-backend/src/owner/backup/services/backup-orchestrator.service.ts:88:7
2|asas-bac |     at Proxy._transactionWithCallback (/www/node-projects/asas-backend/node_modules/@prisma/client/runtime/library.js:130:8000)
2|asas-bac |     at BackupOrchestratorService.startBackup (/www/node-projects/asas-backend/src/owner/backup/services/backup-orchestrator.service.ts:86:17)
2|asas-bac |     at BackupController.triggerBackup (/www/node-projects/asas-backend/src/owner/backup/backup.controller.ts:58:22)
2|asas-bac |     at /www/node-projects/asas-backend/node_modules/@nestjs/core/router/router-execution-context.js:46:28 {
2|asas-bac |   code: 'P2010',
2|asas-bac |   clientVersion: '6.0.0',
2|asas-bac |   meta: {
2|asas-bac |     code: 'N/A',
2|asas-bac |     message: "Failed to deserialize column of type 'void'. If you're using $queryRaw and this column is explicitly marked as `Unsupported` in your Prisma schema, try casting this column to any supported Prisma type such as `String`."
2|asas-bac |   }
2|asas-bac | }
2|asas-bac | [Nest] 3673215  - 07/28/2026, 2:27:45 PM   ERROR [BackupLoggerService] [BackupJob:1][CLEANUP] Pre-flight validation failed: Backup job a398cffe-b4c7-47e2-bbcf-abb17e64338b is currently running (started 2026-07-28T14:27:45.080Z)
2|asas-bac | [Nest] 3674678  - 07/28/2026, 2:39:02 PM   ERROR [PgDumpEngine] Database backup failed: Command failed: pg_dump --dbname postgresql://asasuser:KkEppfLSJCXwr@127.0.0.1:5432/asasprod?schema=public --format plain --clean --if-exists --no-owner --no-privileges --file /var/backups/mafhooom/temp/9fffb72c-2216-43a8-9619-8f287442c022/database/postgres.sql
2|asas-bac | pg_dump: error: invalid URI query parameter: "schema"
2|asas-bac | 
2|asas-bac | [Nest] 3674678  - 07/28/2026, 2:39:02 PM   ERROR [BackupLoggerService] [BackupJob:2][CLEANUP] Database dump failed: Command failed: pg_dump --dbname postgresql://asasuser:KkEppfLSJCXwr@127.0.0.1:5432/asasprod?schema=public --format plain --clean --if-exists --no-owner --no-privileges --file /var/backups/mafhooom/temp/9fffb72c-2216-43a8-9619-8f287442c022/database/postgres.sql
2|asas-bac | pg_dump: error: invalid URI query parameter: "schema"
2|asas-bac | 

/root/.pm2/logs/asas-backend-out.log last 300 lines:
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/manager/sections/:sectionId/timetable, PUT} route +1ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/manager/sections/:sectionId/timetable/subjects, GET} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/manager/sections/:sectionId/timetable/slots/:slotUuid, DELETE} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/manager/sections/:sectionId/timetable/teacher-conflicts, GET} route +1ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RoutesResolver] DashboardController {/api/v1/school/manager/dashboard}: +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/manager/dashboard/stats, GET} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RoutesResolver] RolloverController {/api/v1/school/manager/rollover}: +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/manager/rollover/check-eligibility, GET} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/manager/rollover/preview, POST} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/manager/rollover/execute, POST} route +1ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/manager/rollover/students, GET} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RoutesResolver] MediaController {/api/v1/school/media}: +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/media/:uuid, GET} route +1ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/media/:uuid/meta, GET} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RoutesResolver] MediaUploadController {/api/v1/school/media-upload}: +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/media-upload/sessions, POST} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/media-upload/sessions/:uuid, GET} route +1ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/media-upload/sessions/:uuid/chunks, PUT} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/media-upload/sessions/:uuid/complete, POST} route +1ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/media-upload/sessions/:uuid/cancel, POST} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RoutesResolver] TeacherSubjectsController {/api/v1/school/teacher}: +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/teacher/my-subjects, GET} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RoutesResolver] TeacherUnitsController {/api/v1/school/teacher/subjects/:subjectId/units}: +1ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/teacher/subjects/:subjectId/units, GET} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/teacher/subjects/:subjectId/units, POST} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/teacher/subjects/:subjectId/units/:unitId, PATCH} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/teacher/subjects/:subjectId/units/:unitId, DELETE} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/teacher/subjects/:subjectId/units/reorder, PUT} route +1ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RoutesResolver] TeacherLessonsController {/api/v1/school/teacher}: +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/teacher/subjects/:subjectUuid/lessons-by-units, GET} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/teacher/subjects/:subjectUuid/units/:unitUuid/lessons, POST} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/teacher/lessons/:lessonUuid, PATCH} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/teacher/lessons/:lessonUuid, DELETE} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/teacher/lessons/:lessonUuid/status, PATCH} route +1ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/teacher/lessons/:lessonUuid/blocks, GET} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/teacher/lessons/:lessonUuid/blocks, POST} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/teacher/lessons/:lessonUuid/blocks/reorder, PATCH} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/teacher/lessons/:lessonUuid/blocks/:blockUuid, PATCH} route +1ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/teacher/lessons/:lessonUuid/blocks/:blockUuid, DELETE} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/teacher/lessons/:lessonUuid/blocks/:blockUuid/items, POST} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/teacher/lessons/:lessonUuid/blocks/:blockUuid/items/reorder, PATCH} route +1ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/teacher/lessons/:lessonUuid/blocks/:blockUuid/items/:itemUuid, PATCH} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/teacher/lessons/:lessonUuid/blocks/:blockUuid/items/:itemUuid, DELETE} route +1ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/teacher/lessons/:lessonUuid/blocks/:blockUuid/items/:itemUuid/move, PATCH} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RoutesResolver] TeacherQuestionsController {/api/v1/school/teacher}: +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/teacher/lessons/:lessonUuid/questions, GET} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/teacher/lessons/:lessonUuid/questions, POST} route +1ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/teacher/questions/:questionUuid, GET} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/teacher/questions/:questionUuid, PATCH} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/teacher/questions/:questionUuid, DELETE} route +1ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/teacher/lessons/:lessonUuid/questions/reorder, PATCH} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RoutesResolver] TeacherLessonTargetingController {/api/v1/school/teacher}: +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/teacher/subjects/:subjectUuid/available-sections, GET} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/teacher/subjects/:subjectUuid/sections/:sectionUuid/timetable-slots, GET} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/teacher/lessons/:lessonUuid/targeting, POST} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/teacher/lessons/:lessonUuid/targeting, GET} route +1ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/teacher/lessons/:lessonUuid/publish, POST} route +1ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/teacher/lessons/:lessonUuid/cancel-schedule, POST} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/teacher/lessons/:lessonUuid/delivery-status, GET} route +1ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RoutesResolver] TeacherTimetableController {/api/v1/school/teacher}: +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/teacher/my-timetable, GET} route +1ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RoutesResolver] TeacherReportController {/api/v1/school/teacher/reports}: +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/teacher/reports/filter-options, GET} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/teacher/reports/comprehensive, GET} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/teacher/reports/comprehensive/students/:studentUuid, GET} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/teacher/reports/comprehensive/students/:studentUuid/subjects/:subjectUuid, GET} route +1ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RoutesResolver] ReportsController {/api/v1/school/reports/student-progress}: +2ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/reports/student-progress/filter-options, GET} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/reports/student-progress, GET} route +1ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/reports/student-progress/students/:studentUuid, GET} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/reports/student-progress/students/:studentUuid/subjects/:subjectUuid, GET} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/reports/student-progress/students/:studentUuid/lessons/:lessonUuid/review, GET} route +5ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RoutesResolver] GradesReportController {/api/v1/school/reports/student-grades}: +1ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/reports/student-grades/filter-options, GET} route +1ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/reports/student-grades, GET} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/reports/student-grades/students/:studentUuid, GET} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/reports/student-grades/students/:studentUuid/subjects/:subjectUuid, GET} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RoutesResolver] ComprehensiveReportController {/api/v1/school/reports/comprehensive}: +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/reports/comprehensive/filter-options, GET} route +1ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/reports/comprehensive, GET} route +1ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/reports/comprehensive/students/:studentUuid, GET} route +1ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/reports/comprehensive/students/:studentUuid/subjects/:subjectUuid, GET} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RoutesResolver] PlatformContentController {/api/v1/school/teacher}: +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/teacher/platform-lessons, GET} route +1ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/teacher/platform-lessons/:uuid, GET} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/teacher/platform-lessons/:uuid/fork, POST} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/teacher/platform-lessons/:uuid/fork-and-publish, POST} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RoutesResolver] StudentSubjectsController {/api/v1/school/student}: +1ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/student/my-subjects, GET} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RoutesResolver] StudentTimetableController {/api/v1/school/student}: +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/student/my-timetable, GET} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RoutesResolver] StudentLessonsController {/api/v1/school/student}: +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/student/my-lessons, GET} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/student/lesson/:lessonUuid, GET} route +1ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/student/my-summary, GET} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RoutesResolver] StudentQuizController {/api/v1/school/student}: +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/student/lesson/:lessonUuid/questions, GET} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/student/lesson/:lessonUuid/check-answer, POST} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/student/lesson/:lessonUuid/submit-quiz, POST} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/student/lesson/:lessonUuid/result, GET} route +1ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/student/lesson/:lessonUuid/review, GET} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/student/lesson/:lessonUuid/mark-read, POST} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RoutesResolver] StudentBooksController {/api/v1/school/student}: +1ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/student/my-books, GET} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RoutesResolver] StudentSyncController {/api/v1/school/student/sync}: +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/student/sync/manifest, GET} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/student/sync/pull, POST} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/student/sync/push, POST} route +1ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RoutesResolver] ParentChildrenController {/api/v1/school/parent}: +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/parent/my-children, GET} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/parent/child/:uuid/subjects, GET} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/parent/child/:childUuid/subject/:subjectUuid/lessons, GET} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/parent/child/:childUuid/results, GET} route +1ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/parent/child/:childUuid/subject/:subjectUuid/results, GET} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/school/parent/child/:childUuid/lesson/:lessonUuid/review, GET} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RoutesResolver] PlatformAuthController {/api/v1/auth/platform}: +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/auth/platform/login, POST} route +1ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/auth/platform/refresh, POST} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/auth/platform/logout, POST} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RoutesResolver] PlatformUsersController {/api/v1/platform/users}: +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/platform/users, GET} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/platform/users/:uuid, GET} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/platform/users, POST} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/platform/users/:uuid, PATCH} route +1ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/platform/users/:uuid/status, PATCH} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/platform/users/:uuid/reset-password, POST} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RoutesResolver] PlatformSubjectsController {/api/v1/platform}: +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/platform/subjects, GET} route +1ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/platform/subjects/:uuid, GET} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/platform/subjects, POST} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/platform/subjects/:uuid, PATCH} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/platform/subjects/:uuid/status, PATCH} route +1ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/platform/subjects/:uuid/cover, PATCH} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/platform/subjects/reorder, PATCH} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/platform/grades, GET} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/platform/users/:uuid/subjects, POST} route +1ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/platform/users/:uuid/subjects/:subjectUuid, DELETE} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RoutesResolver] PlatformProfileController {/api/v1/platform/profile}: +1ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/platform/profile, GET} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/platform/profile, PATCH} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/platform/profile/password, PATCH} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RoutesResolver] PlatformUnitsController {/api/v1/platform/subjects/:subjectDictId/units}: +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/platform/subjects/:subjectDictId/units, GET} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/platform/subjects/:subjectDictId/units, POST} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/platform/subjects/:subjectDictId/units/:unitId, PATCH} route +1ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/platform/subjects/:subjectDictId/units/:unitId, DELETE} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/platform/subjects/:subjectDictId/units/reorder, PUT} route +1ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RoutesResolver] PlatformLessonsController {/api/v1/platform}: +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/platform/subjects/:subjectDictUuid/lessons-by-units, GET} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/platform/subjects/:subjectDictUuid/units/:unitUuid/lessons, POST} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/platform/lessons/:lessonUuid, PATCH} route +1ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/platform/lessons/:lessonUuid, DELETE} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/platform/lessons/:lessonUuid/status, PATCH} route +1ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/platform/lessons/:lessonUuid/blocks, GET} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/platform/lessons/:lessonUuid/blocks, POST} route +1ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/platform/lessons/:lessonUuid/blocks/reorder, PATCH} route +1ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/platform/lessons/:lessonUuid/blocks/:blockUuid, PATCH} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/platform/lessons/:lessonUuid/blocks/:blockUuid, DELETE} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/platform/lessons/:lessonUuid/blocks/:blockUuid/items, POST} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/platform/lessons/:lessonUuid/blocks/:blockUuid/items/reorder, PATCH} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/platform/lessons/:lessonUuid/blocks/:blockUuid/items/:itemUuid, PATCH} route +1ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/platform/lessons/:lessonUuid/blocks/:blockUuid/items/:itemUuid, DELETE} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/platform/lessons/:lessonUuid/blocks/:blockUuid/items/:itemUuid/move, PATCH} route +1ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RoutesResolver] PlatformQuestionsController {/api/v1/platform}: +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/platform/lessons/:lessonUuid/questions, GET} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/platform/lessons/:lessonUuid/questions, POST} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/platform/questions/:questionUuid, GET} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/platform/questions/:questionUuid, PATCH} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/platform/questions/:questionUuid, DELETE} route +1ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/platform/lessons/:lessonUuid/questions/reorder, PATCH} route +1ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RoutesResolver] PlatformMediaController {/api/v1/platform/media}: +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/platform/media/:uuid, GET} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/platform/media/:uuid/meta, GET} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RoutesResolver] PlatformMediaUploadController {/api/v1/platform/media-upload}: +1ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/platform/media-upload/sessions, POST} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/platform/media-upload/sessions/:uuid, GET} route +1ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/platform/media-upload/sessions/:uuid/chunks, PUT} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/platform/media-upload/sessions/:uuid/complete, POST} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/platform/media-upload/sessions/:uuid/cancel, POST} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RoutesResolver] PlatformMediaFromUrlController {/api/v1/platform/media}: +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/platform/media/from-url, POST} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RoutesResolver] PlatformBooksController {/api/v1/platform/books}: +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/platform/books, GET} route +1ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/platform/books/:id, GET} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/platform/books, POST} route +1ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/platform/books/:id, PATCH} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/platform/books/:id/toggle, PATCH} route +1ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/platform/books/:id, DELETE} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RoutesResolver] DistributionController {/api/v1/platform}: +1ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/platform/distribute, POST} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/platform/distributions, GET} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/platform/distributions/summary, GET} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/platform/distributions/batches, GET} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RoutesResolver] ImportsController {/api/v1/schools/:schoolUuid/imports}: +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/schools/:schoolUuid/imports/readiness, GET} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/schools/:schoolUuid/imports/students/preview, POST} route +1ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/schools/:schoolUuid/imports/teachers/preview, POST} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/schools/:schoolUuid/imports/:importUuid, GET} route +1ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/schools/:schoolUuid/imports/:importUuid/execute, POST} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/schools/:schoolUuid/imports/:importUuid/credentials, GET} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RoutesResolver] AppsController {/api/v1/releases/apps}: +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/releases/apps, GET} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/releases/apps/:uuid, GET} route +1ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/releases/apps, POST} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/releases/apps/:uuid, PATCH} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RoutesResolver] ReleasesController {/api/v1/releases}: +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/releases/apps/:appUuid/releases, GET} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/releases/apps/:appUuid/releases, POST} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/releases/:uuid, PATCH} route +1ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/releases/:uuid/test, POST} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/releases/:uuid/publish, POST} route +1ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/releases/:uuid/deprecate, POST} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/releases/:uuid/revoke, POST} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/releases/:uuid/distributions, POST} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/releases/distributions/:uuid, PATCH} route +1ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/releases/distributions/:uuid, DELETE} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RoutesResolver] UpdateCheckController {/api/v1/public/app}: +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/public/app/check-update, POST} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RoutesResolver] StatsController {/api/v1/releases/stats}: +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/releases/stats/overview, GET} route +1ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/releases/stats/apps/:appUuid/devices, GET} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RoutesResolver] BackupController {/api/v1/owner/backups}: +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/owner/backups/trigger, POST} route +1ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/owner/backups/jobs, GET} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/owner/backups/jobs/:uuid, GET} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/owner/backups/instances, GET} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/owner/backups/instances/:uuid, GET} route +1ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/owner/backups/instances/:uuid/pin, PATCH} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/owner/backups/instances/:uuid, DELETE} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/owner/backups/plans, GET} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/owner/backups/plans/:id, GET} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/owner/backups/plans/:id, PATCH} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/owner/backups/dashboard, GET} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/owner/backups/restore, POST} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/owner/backups/restore-jobs, GET} route +1ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [RouterExplorer] Mapped {/api/v1/owner/backups/restore-jobs/:uuid, GET} route +0ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [MediaCleanupService] 🧹 Media cleanup service started
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [LocalStorageProvider] Storage initialized at: /var/backups/mafhooom
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [BackupSchedulerService] Scheduled backup "نسخ يومي افتراضي" (0 2 * * *) in Asia/Aden
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [BackupSchedulerService] Backup scheduler synced: 1 active plans
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:03 PM     LOG [NestApplication] Nest application successfully started +9ms
2|asas-bac | 🚀 Server is running on port 3010
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:58 PM     LOG [PreflightValidatorService] Starting pre-flight validation...
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:58 PM     LOG [PreflightValidatorService] Pre-flight validation passed (9 checks)
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:58 PM     LOG [BackupLoggerService] [BackupJob:6][PREFLIGHT] Pre-flight passed (9 checks)
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:58 PM     LOG [PgDumpEngine] Starting pg_dump...
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:58 PM     LOG [PgDumpEngine] pg_dump completed
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:58 PM     LOG [PgDumpEngine] Extracted 1006 media storage keys from dump
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:31:58 PM     LOG [PgDumpEngine] Compressing database dump...
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:32:00 PM     LOG [PgDumpEngine] Database backup completed in 2229ms (4 MB)
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:32:00 PM     LOG [BackupLoggerService] [BackupJob:6][DB_DUMP] Database dump completed (4 MB)
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:32:00 PM     LOG [MediaBackupEngine] Starting media backup: 1006 files expected
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:32:04 PM     LOG [MediaBackupEngine] Media backup progress: 500/1006 (389 missing)
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:32:07 PM     LOG [MediaBackupEngine] Media backup progress: 1000/1006 (793 missing)
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:32:07 PM     LOG [MediaBackupEngine] Media backup completed: 207/1006 files (1288 MB) in 6699ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:32:07 PM    WARN [MediaBackupEngine] 799 media files were missing from disk
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:32:07 PM    WARN [BackupLoggerService] [BackupJob:6][MEDIA_COPY] Media copy: 207/1006 files
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:32:07 PM     LOG [ConfigBackupEngine] Config file copied: .env
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:32:07 PM    WARN [ConfigBackupEngine] Config file not found (skipped): nginx.conf at /etc/nginx/sites-available/asas
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:32:07 PM    WARN [ConfigBackupEngine] Config file not found (skipped): pm2.config.js at /www/node-projects/asas-backend/pm2.config.js
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:32:07 PM     LOG [ConfigBackupEngine] Config backup completed: 1/3 files in 1ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:32:07 PM     LOG [BackupLoggerService] [BackupJob:6][CONFIG_COPY] Config copy: 1 files
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:32:07 PM     LOG [BackupLoggerService] [BackupJob:6][MANIFEST] Manifest created
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:32:49 PM     LOG [BackupLoggerService] [BackupJob:6][COMPRESS] Archive created: backup_2026-07-28_16-32-07.tar.gz (1230 MB)
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:32:55 PM     LOG [BackupLoggerService] [BackupJob:6][CHECKSUM] Checksum: c2fa8e22def38557...
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:32:55 PM   DEBUG [LocalStorageProvider] Moved: /var/backups/mafhooom/temp/backup_2026-07-28_16-32-07.tar.gz → /var/backups/mafhooom/completed/backup_2026-07-28_16-32-07.tar.gz
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:32:55 PM   DEBUG [LocalStorageProvider] Moved: /var/backups/mafhooom/temp/backup_2026-07-28_16-32-07.tar.gz.sha256 → /var/backups/mafhooom/completed/backup_2026-07-28_16-32-07.tar.gz.sha256
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:32:55 PM     LOG [BackupLoggerService] [BackupJob:6][ACTIVATE] Backup activated: backup_2026-07-28_16-32-07.tar.gz
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:32:55 PM   DEBUG [LocalStorageProvider] Deleted directory: /var/backups/mafhooom/temp/cc25cc4d-7833-41a2-a5e3-5908a8c68b4c
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:32:55 PM     LOG [BackupLoggerService] [BackupJob:6][CLEANUP] Temporary files cleaned up
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:32:55 PM     LOG [BackupOrchestratorService] ✅ Backup completed: backup_2026-07-28_16-32-07.tar.gz (PARTIAL_SUCCESS)
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:34:43 PM     LOG [PreflightValidatorService] Starting pre-flight validation...
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:34:43 PM     LOG [PreflightValidatorService] Pre-flight validation passed (9 checks)
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:34:43 PM     LOG [BackupLoggerService] [BackupJob:7][PREFLIGHT] Pre-flight passed (9 checks)
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:34:43 PM     LOG [PgDumpEngine] Starting pg_dump...
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:34:43 PM     LOG [PgDumpEngine] pg_dump completed
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:34:44 PM     LOG [PgDumpEngine] Extracted 1006 media storage keys from dump
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:34:44 PM     LOG [PgDumpEngine] Compressing database dump...
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:34:45 PM     LOG [PgDumpEngine] Database backup completed in 2167ms (4 MB)
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:34:45 PM     LOG [BackupLoggerService] [BackupJob:7][DB_DUMP] Database dump completed (4 MB)
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:34:45 PM     LOG [MediaBackupEngine] Starting media backup: 1006 files expected
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:34:47 PM     LOG [MediaBackupEngine] Media backup progress: 500/1006 (389 missing)
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:34:50 PM     LOG [MediaBackupEngine] Media backup progress: 1000/1006 (793 missing)
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:34:50 PM     LOG [MediaBackupEngine] Media backup completed: 207/1006 files (1288 MB) in 4577ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:34:50 PM    WARN [MediaBackupEngine] 799 media files were missing from disk
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:34:50 PM    WARN [BackupLoggerService] [BackupJob:7][MEDIA_COPY] Media copy: 207/1006 files
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:34:50 PM     LOG [ConfigBackupEngine] Config file copied: .env
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:34:50 PM    WARN [ConfigBackupEngine] Config file not found (skipped): nginx.conf at /etc/nginx/sites-available/asas
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:34:50 PM    WARN [ConfigBackupEngine] Config file not found (skipped): pm2.config.js at /www/node-projects/asas-backend/pm2.config.js
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:34:50 PM     LOG [ConfigBackupEngine] Config backup completed: 1/3 files in 1ms
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:34:50 PM     LOG [BackupLoggerService] [BackupJob:7][CONFIG_COPY] Config copy: 1 files
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:34:50 PM     LOG [BackupLoggerService] [BackupJob:7][MANIFEST] Manifest created
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:35:34 PM     LOG [BackupLoggerService] [BackupJob:7][COMPRESS] Archive created: backup_2026-07-28_16-34-50.tar.gz (1230 MB)
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:35:39 PM     LOG [BackupLoggerService] [BackupJob:7][CHECKSUM] Checksum: c880db01720a9b8d...
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:35:39 PM   DEBUG [LocalStorageProvider] Moved: /var/backups/mafhooom/temp/backup_2026-07-28_16-34-50.tar.gz → /var/backups/mafhooom/completed/backup_2026-07-28_16-34-50.tar.gz
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:35:39 PM   DEBUG [LocalStorageProvider] Moved: /var/backups/mafhooom/temp/backup_2026-07-28_16-34-50.tar.gz.sha256 → /var/backups/mafhooom/completed/backup_2026-07-28_16-34-50.tar.gz.sha256
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:35:39 PM     LOG [BackupLoggerService] [BackupJob:7][ACTIVATE] Backup activated: backup_2026-07-28_16-34-50.tar.gz
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:35:39 PM   DEBUG [LocalStorageProvider] Deleted directory: /var/backups/mafhooom/temp/0b8a646d-cbec-4ae8-b162-895ccf4caf20
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:35:39 PM     LOG [BackupLoggerService] [BackupJob:7][CLEANUP] Temporary files cleaned up
2|asas-bac | [Nest] 3681701  - 07/28/2026, 4:35:39 PM     LOG [BackupOrchestratorService] ✅ Backup completed: backup_2026-07-28_16-34-50.tar.gz (PARTIAL_SUCCESS)


## أولاً: مشكلة `pg_dump` انتهت تمامًا ✅

السجل الجديد يثبت أن الإصلاح تم تطبيقه بالفعل:

```text
Starting pg_dump...
pg_dump completed
Extracted 1006 media storage keys from dump
Database backup completed
```

أي أن مشكلة:

```text
?schema=public
```

لم تعد موجودة.

---

# ثانياً: الإصلاح الذي أضفته لم يحل مشكلة الوسائط

ما زال الناتج هو:

```text
Expected: 1006
Copied:   207
Missing: 799
```

وتكرر نفس الرقم في نسختين احتياطيتين متتاليتين:

```
BackupJob:6
207 / 1006

BackupJob:7
207 / 1006
```

وهذا مهم جداً.

---

# ماذا يعني هذا؟

قبل تعديل `PgDumpEngine` كنا نشك في أن المشكلة هي:

```
storage_key
```

يشير إلى

```
original.jpg
```

بينما الملف الحقيقي

```
original.webp
```

ولذلك اقترح Claude استخراج المفاتيح من:

```
variants_json
```

لكن الآن...

بعد تطبيق الإصلاح...

ما زال:

```
207 فقط
```

إذن المشكلة ليست استخراج المفاتيح.

---

# الاستنتاج

لدينا أحد احتمالين فقط.

## الاحتمال الأول (الأرجح)

الـ dump ما زال يستخرج:

```
1006 storage keys
```

ولكن هذه المفاتيح نفسها هي:

```
original.jpg
```

وليس

```
original.webp
```

أي أن الـ parser لم يقرأ

```
variants_json
```

كما كنا نظن.

---

## الاحتمال الثاني

قرأ variants_json

لكن

```
variants_json
```

فارغ في أغلب الصفوف.

وقد رأينا سابقًا مثالًا مثل:

```
variants_json = NULL
preferred_variant = NULL
```

وهذا يفسر تمامًا لماذا لم يتغير العدد.

---

# أكثر شيء لفت انتباهي

السجل يقول فقط:

```
Extracted 1006 media storage keys from dump
```

ولا يقول:

```
storage_key:
xxx

variant:
yyy
```

أي أننا لا نعرف فعليًا ماذا استخرج.

---

# الخطوة التالية

بدلاً من التخمين، يجب أن نعرف ماذا يحاول النظام نسخه فعليًا.

أقترح إضافة Log مؤقت داخل `MediaBackupEngine` قبل النسخ مباشرة، مثل:

```ts
logger.log(`Trying: ${storageKey}`);
```

ولأول 20 ملف فقط:

```ts
mediaKeys.slice(0, 20).forEach(k =>
  logger.log(k)
);
```

إذا ظهر مثلًا:

```
tenant1/.../original.jpg
tenant1/.../original.jpg
tenant1/.../original.jpg
```

فقد انتهى التحقيق مباشرة؛ لأن النظام ما زال يستخدم مفاتيح قديمة.

أما إذا ظهر:

```
tenant1/.../original.webp
```

فسننتقل للتحقيق في `resolvePath()` أو وجود الملفات على القرص.

---

# لا أنصح بالتخمين الآن

بعد هذا السجل أصبح واضحًا أن المشكلة **ليست في `pg_dump`**، بل في **البيانات التي يتم تمريرها إلى `MediaBackupEngine` أو في طريقة استخدام هذه البيانات**.

أفضل خطوة الآن هي عرض أول 20 مفتاحًا (`storageKey`) التي يحاول `MediaBackupEngine` نسخها، لأن ذلك سيحدد سبب فقدان الـ 799 ملفًا خلال دقيقة واحدة بدلًا من الاستمرار في تعديل الكود بشكل تجريبي.
