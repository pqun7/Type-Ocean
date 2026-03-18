Plan: PvP Gateway Critical Stabilizationالهدف
إغلاق مخاطر الأداء والسباقات والتسربات المؤكدة في مسار PvP Gateway بدون توسيع النطاق إلى refactor كبير.
النهج: (1) إزالة O(C) fanout، (2) توحيد finalization locking، (3) تقوية disconnect-forfeit + input flush، (4) cleanup حتمي للـ Maps والـ timers.StepsPhase A – Baseline and Safety Guards  تعريف baseline metrics قبل أي تغيير (pvp_ws_outbound_messages_total، pvp_active_connections، pvp_input_update_*، زمن معالجة الرسائل).  
توثيق invariants يجب ألا تتغير: no-show فقط في waiting_for_both، disconnect forfeit فقط في live، finalization وحيد لكل matchId.

Phase B – Eliminate O(C) Fanout Hot Paths (depends on A)  إضافة فهارس socketsByUser + socketsByRoom + socketsByMatch داخل MatchCache (إعادة استخدام الطبقة الموجودة).  
تحديث lifecycle hooks (HELLO، ROOM_JOIN/LEAVE، MATCH_JOIN/LEAVE، ws.close) لضمان التسجيل/الإزالة الحتمية.  
استبدال getAuthedSocketsForUser ليقرأ من user index (بدل loop على wss.clients).  
استبدال broadcastRoom ليبث مباشرة إلى room index.  
جعل broadcastMatch يعتمد دائماً على socketsByMatch داخل MatchCache (local optimization حتى لو Redis مفعل).  
إضافة fallback آمن (telemetry + self-heal) إذا كانت الفهارس فارغة.

Phase C – Finalization Race Hardening (depends on B)  توحيد كل terminal transitions عبر helper واحد (acquireFinalizationLock) يدير: local lock + DB lock + idempotent exit.  
تغليف finalizeMatchResults، finalizeMatchIfComplete، finalizeMatchByDisconnectForfeit، abortMatchLifecycle.  
إضافة telemetry لأسباب منع الـ finalization (local miss / DB miss / already terminal).

Phase D – Join/Forfeit and Input Flush Durability (depends on C)  إعادة ترتيب clearDisconnectForfeitTimer في MATCH_JOIN (post-DB-lock + grace validation) لمنع match_closed الوهمي.  
تقوية flushPendingInputUpdates بـ batch ownership + maxRetries + monotonic maxSeqByUser أثناء requeue.  
observability لعدد دورات إعادة المحاولة لكل match.

Phase E – Memory Leak & Lifecycle Cleanup (parallel with D after C)  expiry cleanup دوري + lazy delete لـ aiRematchRefuseUntilByHumanId.  
cleanup policy لـ rematchAcceptedByMatchId بعد إنشاء rematch أو TTL.  
مراجعة cleanup شاملة لـ participantMetricAccumulators + noShowTimers + disconnectForfeitTimers في كل terminal path + shutdown.  
إضافة cleanup دوري لـ roomActionLastSeen Map (كل 60 ثانية أو عند ws.close).

Phase F – Optional Performance Enhancements (deferred)  Prepared statements في Drizzle (فقط بعد إثبات bottleneck).  
Short cache لـ room state (TTL 3-5s) فقط إذا أظهرت القياسات حاجة.

Relevant files  services/pvp-gateway/src/index.ts — fanout، locks، timers، flush.  
services/pvp-gateway/src/match-cache.ts — إضافة socketsByUser / socketsByRoom / socketsByMatch.  
services/pvp-gateway/src/ai-simulation.ts — توافق broadcast مع الفهارس الجديدة.  
الاختبارات: pvp-disconnect-forfeit.test.ts، pvp-match-fsm.test.ts، pvp-input-update.test.ts، pvp-room-lifecycle.test.ts.

Verification  تشغيل الاختبارات المركزة (disconnect، fsm، input-update، room-lifecycle، match-sync).  
npm run build كامل.  
load test (3k–10k sockets) مع نسبة عالية من ROOM_STATE/PROGRESS.  
تحقق invariants: لا duplicate RESULTS، لا match_closed وهمي، لا فقد progress.  
مراقبة الـ metric الجديد:
observeGatewayHistogram("pvp_fanout_duration_ms", duration, [1, 5, 10, 25], { type: "room" | "user" | "match" })
→ يجب أن ينخفض زمن fanout بنسبة ≥ 70-90% بعد Phase B.

Decisions  النطاق: Critical only.  
Single-instance safe (مع نقاط ترقية جاهزة لـ Redis).  
داخل النطاق: O(C) elimination + race hardening + leak cleanup + flush durability.  
خارج النطاق: إزالة @ts-nocheck، refactor typing، تغييرات بنيوية في repository.

Further Considerations  إذا أصبح multi-instance production مؤكداً → تفعيل Redis-backed room-action cooldown كمرحلة مستقلة تالية.  
Prepared statements تُنفذ فقط بعد قياس bottleneck حقيقي.  
Canary rollout مع metric gate: إذا لم ينخفض fanout CPU/latency بشكل ملحوظ → نراجع تصميم الفهارس.
