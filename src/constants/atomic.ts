// lib/redis/atomicUpdates.ts
export const UPDATE_CHALLENGE_SCRIPT = `
  local key = KEYS[1]
  local progress = cjson.decode(ARGV[1])
  local operation = ARGV[2]
  local today = ARGV[3]
  local ttl = ARGV[4]
  
  local existing = redis.call('GET', key)
  if not existing then
    return false
  end
  
  local challenge = cjson.decode(existing)
  if challenge.date ~= today then
    return 'expired'
  end
  
  -- Merge progress based on operation type
  if operation == 'increment' then
    challenge.progress = mergeIncrementalProgress(challenge.progress, progress)
  else
    challenge.progress = progress
  end
  
  -- Recalculate status
  challenge.status = calculateLuaStatus(challenge, challenge.progress)
  
  redis.call('SETEX', key, ttl, cjson.encode(challenge))
  return cjson.encode(challenge)
`;

export const LUA_UPDATE_STATS_SCRIPT = `
    -- KEYS[1] = User stats key (e.g., user:longterm:USER_ID)
    -- ARGV[1] = New WPM (string)
    -- ARGV[2] = New Accuracy (string)
    -- ARGV[3] = TimeSpent (string)
    -- ARGV[4] = TextLength (string)
    -- ARGV[5] = WordsTyped (calculated in Node.js) (string)
    -- ARGV[6] = Current timestamp (ISO string)
    -- ARGV[7] = TTL (seconds) (string)

    local stats = redis.call('HGETALL', KEYS[1])
    local current = {}
    local newStatsPayload = {}

    for i = 1, #stats, 2 do
      current[stats[i]] = stats[i+1]
    end

    local newWPM = tonumber(ARGV[1])
    local newAcc = tonumber(ARGV[2])
    local timeSpent = tonumber(ARGV[3])
    local textLength = tonumber(ARGV[4])
    local wordsTyped = tonumber(ARGV[5])

    if not newWPM then newWPM = 0 end
    if not newAcc then newAcc = 0 end
    if not timeSpent then timeSpent = 0 end
    if not textLength then textLength = 0 end
    if not wordsTyped then wordsTyped = 0 end

    local totalSessions
    if #stats == 0 then
      -- ===== New user =====
      totalSessions = 1
      local totalTimeTyped = timeSpent
      local totalWordsTyped = wordsTyped
      local totalCharactersTyped = textLength

      -- Time-weighted averages
      local avgWPM = 0
      if totalTimeTyped > 0 then
        avgWPM = (totalWordsTyped * 60) / totalTimeTyped
      end

      local accuracyTimeSum = newAcc * totalTimeTyped
      local avgAcc = 0
      if totalTimeTyped > 0 then
        avgAcc = accuracyTimeSum / totalTimeTyped
      else
        avgAcc = newAcc
      end

      -- Keep an unweighted snapshot for debugging/compat
      local unweightedAvgWPM = newWPM
      local unweightedAvgAcc = newAcc

      newStatsPayload = {
        "totalSessions", "1",
        "totalTimeTyped", tostring(totalTimeTyped),
        "totalWordsTyped", tostring(totalWordsTyped),
        "totalCharactersTyped", tostring(totalCharactersTyped),
        "averageWPM", tostring(math.floor(avgWPM * 100 + 0.5) / 100),
        "averageAccuracy", tostring(math.floor(avgAcc * 100 + 0.5) / 100),
        "accuracyTimeSum", tostring(accuracyTimeSum),
        "unweightedAverageWPM", tostring(math.floor(unweightedAvgWPM * 100 + 0.5) / 100),
        "unweightedAverageAccuracy", tostring(math.floor(unweightedAvgAcc * 100 + 0.5) / 100),
        "bestWPM", ARGV[1],
        "bestWPMDate", ARGV[6],
        "bestAccuracy", ARGV[2],
        "bestAccuracyDate", ARGV[6],
        "lastUpdated", ARGV[6]
      }
    else
      -- ===== Existing user =====
      local currentTotalSessions = tonumber(current.totalSessions) or 0
      totalSessions = currentTotalSessions + 1
      
      local currentBestWPM = tonumber(current.bestWPM) or 0
      local currentBestAcc = tonumber(current.bestAccuracy) or 0

      local prevTotalTime = tonumber(current.totalTimeTyped) or 0
      local prevTotalWords = tonumber(current.totalWordsTyped) or 0
      local prevTotalChars = tonumber(current.totalCharactersTyped) or 0

      local newTotalTime = prevTotalTime + timeSpent
      local newTotalWords = prevTotalWords + wordsTyped
      local newTotalChars = prevTotalChars + textLength

      -- Weighted WPM from totals (seconds)
      local weightedAvgWPM = 0
      if newTotalTime > 0 then
        weightedAvgWPM = (newTotalWords * 60) / newTotalTime
      end

      -- Weighted accuracy needs an accumulator (accuracy * seconds)
      local prevAccTimeSum = tonumber(current.accuracyTimeSum)
      if not prevAccTimeSum then
        -- Best-effort backfill for older data (previous avg may not have been weighted)
        local prevAvgAcc = tonumber(current.averageAccuracy) or 0
        prevAccTimeSum = prevAvgAcc * prevTotalTime
      end

      local newAccTimeSum = prevAccTimeSum + (newAcc * timeSpent)
      local weightedAvgAcc = 0
      if newTotalTime > 0 then
        weightedAvgAcc = newAccTimeSum / newTotalTime
      else
        weightedAvgAcc = newAcc
      end

      -- Maintain unweighted per-session averages for debugging
      local currentUnweightedAvgWPM = tonumber(current.unweightedAverageWPM)
      if not currentUnweightedAvgWPM then
        currentUnweightedAvgWPM = tonumber(current.averageWPM) or 0
      end

      local currentUnweightedAvgAcc = tonumber(current.unweightedAverageAccuracy)
      if not currentUnweightedAvgAcc then
        currentUnweightedAvgAcc = tonumber(current.averageAccuracy) or 0
      end

      local newUnweightedAvgWPM = (currentUnweightedAvgWPM * (totalSessions - 1) + newWPM) / totalSessions
      local newUnweightedAvgAcc = (currentUnweightedAvgAcc * (totalSessions - 1) + newAcc) / totalSessions

      newStatsPayload = {
        "totalSessions", tostring(totalSessions),
        "totalTimeTyped", tostring(newTotalTime),
        "totalWordsTyped", tostring(newTotalWords),
        "totalCharactersTyped", tostring(newTotalChars),
        "averageWPM", tostring(math.floor(weightedAvgWPM * 100 + 0.5) / 100),
        "averageAccuracy", tostring(math.floor(weightedAvgAcc * 100 + 0.5) / 100),
        "accuracyTimeSum", tostring(newAccTimeSum),
        "unweightedAverageWPM", tostring(math.floor(newUnweightedAvgWPM * 100 + 0.5) / 100),
        "unweightedAverageAccuracy", tostring(math.floor(newUnweightedAvgAcc * 100 + 0.5) / 100),
        "lastUpdated", ARGV[6]
      }

      -- Update best values
      if newWPM > currentBestWPM then
        table.insert(newStatsPayload, "bestWPM")
        table.insert(newStatsPayload, ARGV[1])
        table.insert(newStatsPayload, "bestWPMDate")
        table.insert(newStatsPayload, ARGV[6])
      end
      
      if newAcc > currentBestAcc then
        table.insert(newStatsPayload, "bestAccuracy")
        table.insert(newStatsPayload, ARGV[2])
        table.insert(newStatsPayload, "bestAccuracyDate")
        table.insert(newStatsPayload, ARGV[6])
      end
    end

    redis.call('HSET', KEYS[1], unpack(newStatsPayload))
    redis.call('EXPIRE', KEYS[1], ARGV[7])

    -- Return the updated data
    return redis.call('HGETALL', KEYS[1])
    `;

