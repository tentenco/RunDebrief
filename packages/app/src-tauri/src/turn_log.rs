use reqwest::{Client, Response};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::sqlite::{SqliteConnectOptions, SqliteConnection};
use sqlx::Connection;
use std::collections::{BTreeMap, VecDeque};
use std::ffi::OsStr;
use std::fs::{self, File};
use std::io::{self, BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::time::Duration;

const DEFAULT_TURN_LIMIT: usize = 20;
const MAX_TURN_LIMIT: usize = 20;
const MAX_LINE_BYTES: usize = 4 * 1024 * 1024;
const MAX_ACCEPTED_TURN_BYTES: usize = 2 * 1024 * 1024;
const MAX_TIMESTAMP_BYTES: usize = 128;
const MAX_RETURNED_PAGE_BYTES: usize = 8 * 1024 * 1024;
const MAX_RECONCILIATION_TURNS: usize = 512;
const MAX_RECONCILIATION_BYTES: usize = 16 * 1024 * 1024;
const CLAUDE_MEM_ORIGIN: &str = "http://127.0.0.1:37701";
const CLAUDE_MEM_PAGE_SIZE: usize = 100;
const MAX_CLAUDE_MEM_PAGES: usize = 5;
const MAX_CLAUDE_MEM_RESPONSE_BYTES: usize = 512 * 1024;
const MAX_CLAUDE_MEM_AGGREGATE_BYTES: usize = 2 * 1024 * 1024;
const CLAUDE_MEM_CONNECT_TIMEOUT: Duration = Duration::from_millis(150);
const CLAUDE_MEM_REQUEST_TIMEOUT: Duration = Duration::from_millis(500);
const CLAUDE_MEM_TOTAL_TIMEOUT: Duration = Duration::from_millis(1_500);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionTurnLogPage {
    session_id: i64,
    turns: Vec<SessionTurn>,
    total_turns: u64,
    has_earlier: bool,
    skipped_lines: u64,
    limit: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionTurn {
    ordinal: u64,
    timestamp: Option<String>,
    user_prompt: String,
    assistant_response: Option<String>,
}

struct ParsedTurnLog {
    session_id: i64,
    turns: VecDeque<StoredTurn>,
    total_turns: u64,
    skipped_lines: u64,
    hybrid_eligible: bool,
}

#[derive(Debug, Deserialize)]
struct ClaudeMemVersion {
    version: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClaudeMemPromptPage {
    items: Vec<ClaudeMemPromptItem>,
    has_more: bool,
    offset: usize,
    limit: usize,
}

#[derive(Debug, Deserialize)]
struct ClaudeMemPromptItem {
    content_session_id: String,
    platform_source: String,
    prompt_number: u64,
    prompt_text: String,
    created_at_epoch: i64,
}

#[derive(Debug)]
struct PreferredPrompt {
    prompt_number: u64,
    prompt_text: String,
    created_at_epoch: i64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum SessionTool {
    ClaudeCode,
    Codex,
}

#[derive(Debug, Eq, PartialEq)]
pub enum TurnLogError {
    DatabaseUnavailable,
    SessionNotFound,
    SourceUnavailable,
    SourceOutsideAllowedRoot,
    UnsupportedTool,
    ReadFailed,
    AcceptedTurnTooLarge,
    PageTooLarge,
    WorkerFailed,
}

impl TurnLogError {
    pub fn category(&self) -> &'static str {
        match self {
            Self::DatabaseUnavailable => "database_unavailable",
            Self::SessionNotFound => "session_not_found",
            Self::SourceUnavailable => "source_unavailable",
            Self::SourceOutsideAllowedRoot => "source_outside_allowed_root",
            Self::UnsupportedTool => "unsupported_tool",
            Self::ReadFailed => "read_failed",
            Self::AcceptedTurnTooLarge => "accepted_turn_too_large",
            Self::PageTooLarge => "page_too_large",
            Self::WorkerFailed => "worker_failed",
        }
    }

    pub fn user_message(&self) -> &'static str {
        match self {
            Self::SessionNotFound => "找不到這個 session 的原始紀錄。",
            Self::AcceptedTurnTooLarge | Self::PageTooLarge => {
                "這個 session 的原始訊息過大，無法在安全限制內完整顯示。"
            }
            Self::SourceOutsideAllowedRoot | Self::UnsupportedTool => {
                "這個 session 的原始紀錄位置不在允許範圍內。"
            }
            Self::DatabaseUnavailable
            | Self::SourceUnavailable
            | Self::ReadFailed
            | Self::WorkerFailed => "無法讀取這個 session 的原始紀錄。",
        }
    }
}

pub async fn load_session_turn_log(
    database_path: &Path,
    home_directory: &Path,
    session_id: i64,
    requested_limit: Option<u32>,
) -> Result<SessionTurnLogPage, TurnLogError> {
    if session_id <= 0 {
        return Err(TurnLogError::SessionNotFound);
    }
    let (tool, source_path) = query_session_source(database_path, session_id).await?;
    let source_path = validate_source_path(home_directory, tool, &source_path)?;
    let limit = requested_limit
        .map(|value| value as usize)
        .unwrap_or(DEFAULT_TURN_LIMIT)
        .clamp(1, MAX_TURN_LIMIT);
    let content_session_id = content_session_id_from_source(tool, &source_path);
    let reconciliation_byte_cap = if content_session_id.is_some() {
        Some(MAX_RECONCILIATION_BYTES)
    } else {
        None
    };

    let raw_turn_log = tauri::async_runtime::spawn_blocking(move || {
        let file = File::open(source_path).map_err(|_| TurnLogError::SourceUnavailable)?;
        parse_raw_turn_log(
            BufReader::new(file),
            tool,
            session_id,
            limit,
            reconciliation_byte_cap,
        )
    });
    let preferred_prompts = match content_session_id {
        Some(content_session_id) => fetch_claude_mem_prompts(tool, &content_session_id).await,
        None => None,
    };
    let parsed = raw_turn_log
        .await
        .map_err(|_| TurnLogError::WorkerFailed)??;
    project_turn_log(parsed, limit, preferred_prompts.as_deref())
}

async fn query_session_source(
    database_path: &Path,
    session_id: i64,
) -> Result<(SessionTool, PathBuf), TurnLogError> {
    if !database_path.is_file() {
        return Err(TurnLogError::DatabaseUnavailable);
    }
    let options = SqliteConnectOptions::new()
        .filename(database_path)
        .create_if_missing(false)
        .read_only(true)
        .busy_timeout(Duration::from_secs(2));
    let mut connection = SqliteConnection::connect_with(&options)
        .await
        .map_err(|_| TurnLogError::DatabaseUnavailable)?;
    let row = sqlx::query_as::<_, (Option<String>, Option<String>)>(
        "SELECT tool, source_path FROM sessions WHERE id = ?",
    )
    .bind(session_id)
    .fetch_optional(&mut connection)
    .await
    .map_err(|_| TurnLogError::DatabaseUnavailable)?;
    connection
        .close()
        .await
        .map_err(|_| TurnLogError::DatabaseUnavailable)?;

    let (tool, source_path) = row.ok_or(TurnLogError::SessionNotFound)?;
    let tool = match tool.as_deref() {
        Some("claude-code") => SessionTool::ClaudeCode,
        Some("codex") => SessionTool::Codex,
        _ => return Err(TurnLogError::UnsupportedTool),
    };
    let source_path = source_path
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .ok_or(TurnLogError::SourceUnavailable)?;
    Ok((tool, source_path))
}

fn validate_source_path(
    home_directory: &Path,
    tool: SessionTool,
    source_path: &Path,
) -> Result<PathBuf, TurnLogError> {
    if !source_path.is_absolute() || source_path.extension() != Some(OsStr::new("jsonl")) {
        return Err(TurnLogError::SourceOutsideAllowedRoot);
    }
    let root = match tool {
        SessionTool::ClaudeCode => home_directory.join(".claude").join("projects"),
        SessionTool::Codex => home_directory.join(".codex").join("sessions"),
    };
    let canonical_root = fs::canonicalize(root).map_err(|_| TurnLogError::SourceUnavailable)?;
    let canonical_source =
        fs::canonicalize(source_path).map_err(|_| TurnLogError::SourceUnavailable)?;
    if !canonical_source.starts_with(&canonical_root) || !canonical_source.is_file() {
        return Err(TurnLogError::SourceOutsideAllowedRoot);
    }
    Ok(canonical_source)
}

fn content_session_id_from_source(tool: SessionTool, source_path: &Path) -> Option<String> {
    let stem = source_path.file_stem()?.to_str()?;
    let candidate = match tool {
        SessionTool::ClaudeCode => stem,
        SessionTool::Codex => {
            let remainder = stem.strip_prefix("rollout-")?;
            if remainder.len() != 19 + 1 + 36 {
                return None;
            }
            let (timestamp, suffix) = remainder.split_at(19);
            if !is_codex_filename_timestamp(timestamp) {
                return None;
            }
            suffix.strip_prefix('-')?
        }
    };
    is_uuid(candidate).then(|| candidate.to_ascii_lowercase())
}

fn is_uuid(value: &str) -> bool {
    if value.len() != 36 {
        return false;
    }
    value.bytes().enumerate().all(|(index, byte)| {
        if matches!(index, 8 | 13 | 18 | 23) {
            byte == b'-'
        } else {
            byte.is_ascii_hexdigit()
        }
    })
}

fn is_codex_filename_timestamp(value: &str) -> bool {
    if value.len() != 19 {
        return false;
    }
    value.bytes().enumerate().all(|(index, byte)| {
        if matches!(index, 4 | 7 | 13 | 16) {
            byte == b'-'
        } else if index == 10 {
            byte == b'T'
        } else {
            byte.is_ascii_digit()
        }
    })
}

fn claude_mem_platform(tool: SessionTool) -> &'static str {
    match tool {
        SessionTool::ClaudeCode => "claude",
        SessionTool::Codex => "codex",
    }
}

async fn fetch_claude_mem_prompts(
    tool: SessionTool,
    content_session_id: &str,
) -> Option<Vec<PreferredPrompt>> {
    tokio::time::timeout(
        CLAUDE_MEM_TOTAL_TIMEOUT,
        fetch_claude_mem_prompts_at(CLAUDE_MEM_ORIGIN, tool, content_session_id),
    )
    .await
    .ok()
    .flatten()
}

async fn fetch_claude_mem_prompts_at(
    origin: &str,
    tool: SessionTool,
    content_session_id: &str,
) -> Option<Vec<PreferredPrompt>> {
    let client = Client::builder()
        .connect_timeout(CLAUDE_MEM_CONNECT_TIMEOUT)
        .timeout(CLAUDE_MEM_REQUEST_TIMEOUT)
        .redirect(reqwest::redirect::Policy::none())
        .no_proxy()
        .build()
        .ok()?;
    let mut aggregate_bytes = 0_usize;
    let version_response = client
        .get(format!("{origin}/api/version"))
        .send()
        .await
        .ok()?;
    let version_body = read_bounded_response(version_response).await?;
    aggregate_bytes = aggregate_bytes.checked_add(version_body.len())?;
    if aggregate_bytes > MAX_CLAUDE_MEM_AGGREGATE_BYTES {
        return None;
    }
    let version: ClaudeMemVersion = serde_json::from_slice(&version_body).ok()?;
    if !is_compatible_claude_mem_version(&version.version) {
        return None;
    }

    let platform_source = claude_mem_platform(tool);
    let mut offset = 0_usize;
    let mut prompts = BTreeMap::<u64, PreferredPrompt>::new();
    for _ in 0..MAX_CLAUDE_MEM_PAGES {
        let response = client
            .get(format!("{origin}/api/prompts"))
            .query(&[
                ("offset", offset.to_string()),
                ("limit", CLAUDE_MEM_PAGE_SIZE.to_string()),
                ("platformSource", platform_source.to_owned()),
            ])
            .send()
            .await
            .ok()?;
        let body = read_bounded_response(response).await?;
        aggregate_bytes = aggregate_bytes.checked_add(body.len())?;
        if aggregate_bytes > MAX_CLAUDE_MEM_AGGREGATE_BYTES {
            return None;
        }
        let page: ClaudeMemPromptPage = serde_json::from_slice(&body).ok()?;
        if page.offset != offset
            || page.limit != CLAUDE_MEM_PAGE_SIZE
            || page.items.len() > CLAUDE_MEM_PAGE_SIZE
        {
            return None;
        }
        for item in page.items {
            if item.content_session_id != content_session_id {
                continue;
            }
            if item.platform_source != platform_source
                || item.prompt_number == 0
                || item.prompt_text.trim().is_empty()
                || item.prompt_text.len() > MAX_ACCEPTED_TURN_BYTES
                || prompts.contains_key(&item.prompt_number)
            {
                return None;
            }
            prompts.insert(
                item.prompt_number,
                PreferredPrompt {
                    prompt_number: item.prompt_number,
                    prompt_text: item.prompt_text,
                    created_at_epoch: item.created_at_epoch,
                },
            );
        }
        if prompts.contains_key(&1) {
            return complete_prompt_run(prompts);
        }
        if !page.has_more {
            return None;
        }
        offset = offset.checked_add(CLAUDE_MEM_PAGE_SIZE)?;
    }
    None
}

async fn read_bounded_response(mut response: Response) -> Option<Vec<u8>> {
    if !response.status().is_success()
        || response
            .content_length()
            .is_some_and(|length| length > MAX_CLAUDE_MEM_RESPONSE_BYTES as u64)
    {
        return None;
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.ok()? {
        if body.len().saturating_add(chunk.len()) > MAX_CLAUDE_MEM_RESPONSE_BYTES {
            return None;
        }
        body.extend_from_slice(&chunk);
    }
    Some(body)
}

fn is_compatible_claude_mem_version(version: &str) -> bool {
    let mut parts = version.split('.');
    matches!(
        (
            parts.next().and_then(|value| value.parse::<u64>().ok()),
            parts.next().and_then(|value| value.parse::<u64>().ok()),
            parts.next().and_then(|value| value.parse::<u64>().ok()),
            parts.next(),
        ),
        (Some(13), Some(12), Some(_), None)
    )
}

fn complete_prompt_run(prompts: BTreeMap<u64, PreferredPrompt>) -> Option<Vec<PreferredPrompt>> {
    if prompts.is_empty() {
        return None;
    }
    let ordered = prompts.into_values().collect::<Vec<_>>();
    if ordered
        .iter()
        .enumerate()
        .any(|(index, prompt)| prompt.prompt_number != index as u64 + 1)
        || ordered
            .windows(2)
            .any(|pair| pair[0].created_at_epoch > pair[1].created_at_epoch)
    {
        return None;
    }
    Some(ordered)
}

#[cfg(test)]
fn parse_turn_log<R: BufRead>(
    reader: R,
    tool: SessionTool,
    session_id: i64,
    limit: usize,
) -> Result<SessionTurnLogPage, TurnLogError> {
    let parsed = parse_raw_turn_log(reader, tool, session_id, limit, None)?;
    project_turn_log(parsed, limit, None)
}

fn parse_raw_turn_log<R: BufRead>(
    mut reader: R,
    tool: SessionTool,
    session_id: i64,
    fallback_limit: usize,
    reconciliation_byte_cap: Option<usize>,
) -> Result<ParsedTurnLog, TurnLogError> {
    let mut turns = VecDeque::with_capacity(fallback_limit);
    let mut pending: Option<PendingTurn> = None;
    let mut total_turns = 0_u64;
    let mut skipped_lines = 0_u64;
    let mut hybrid_eligible = reconciliation_byte_cap.is_some();
    let mut reconciliation_bytes = 0_usize;

    stream_bounded_lines(&mut reader, |line| {
        let Some(line) = line else {
            skipped_lines += 1;
            return Ok(());
        };
        if line.iter().all(u8::is_ascii_whitespace) {
            return Ok(());
        }
        let value: Value = match serde_json::from_slice(line) {
            Ok(value) => value,
            Err(_) => {
                skipped_lines += 1;
                return Ok(());
            }
        };
        let Some(message) = accepted_message(&value, tool) else {
            return Ok(());
        };
        match message.role {
            MessageRole::User => {
                if let Some(completed) = pending.take() {
                    retain_parsed_turn(
                        &mut turns,
                        completed.finish(),
                        fallback_limit,
                        reconciliation_byte_cap,
                        &mut hybrid_eligible,
                        &mut reconciliation_bytes,
                    );
                }
                total_turns += 1;
                pending = Some(PendingTurn::new(
                    total_turns,
                    message.timestamp,
                    message.text,
                ));
            }
            MessageRole::Assistant => {
                if let Some(turn) = pending.as_mut() {
                    turn.push_assistant(message.text);
                }
            }
        }
        Ok(())
    })
    .map_err(|_| TurnLogError::ReadFailed)?;

    if let Some(completed) = pending {
        retain_parsed_turn(
            &mut turns,
            completed.finish(),
            fallback_limit,
            reconciliation_byte_cap,
            &mut hybrid_eligible,
            &mut reconciliation_bytes,
        );
    }
    Ok(ParsedTurnLog {
        session_id,
        turns,
        total_turns,
        skipped_lines,
        hybrid_eligible,
    })
}

fn project_turn_log(
    parsed: ParsedTurnLog,
    limit: usize,
    preferred_prompts: Option<&[PreferredPrompt]>,
) -> Result<SessionTurnLogPage, TurnLogError> {
    let ParsedTurnLog {
        session_id,
        turns,
        total_turns,
        skipped_lines,
        hybrid_eligible,
    } = parsed;
    let matched_indices = preferred_prompts
        .filter(|_| hybrid_eligible && total_turns == turns.len() as u64)
        .and_then(|prompts| unique_exact_subsequence(&turns, prompts));
    let (turns, projected_total) =
        if let (Some(prompts), Some(indices)) = (preferred_prompts, matched_indices) {
            let index_to_prompt = indices.into_iter().zip(prompts).collect::<BTreeMap<_, _>>();
            let matched = turns
                .into_iter()
                .enumerate()
                .filter_map(|(index, mut turn)| {
                    let prompt = index_to_prompt.get(&index)?;
                    turn.ordinal = prompt.prompt_number;
                    turn.user_prompt.clone_from(&prompt.prompt_text);
                    Some(turn)
                })
                .collect::<VecDeque<_>>();
            let total = matched.len() as u64;
            (matched, total)
        } else {
            (turns, total_turns)
        };
    let mut turns = turns;
    while turns.len() > limit {
        turns.pop_front();
    }
    if turns.iter().any(|turn| turn.oversized) {
        return Err(TurnLogError::AcceptedTurnTooLarge);
    }
    let page_bytes = turns.iter().map(StoredTurn::retained_bytes).sum::<usize>();
    if page_bytes > MAX_RETURNED_PAGE_BYTES {
        return Err(TurnLogError::PageTooLarge);
    }
    let turns = turns
        .into_iter()
        .map(StoredTurn::into_session_turn)
        .collect::<Vec<_>>();
    Ok(SessionTurnLogPage {
        session_id,
        has_earlier: projected_total > turns.len() as u64,
        turns,
        total_turns: projected_total,
        skipped_lines,
        limit,
    })
}

fn unique_exact_subsequence(
    turns: &VecDeque<StoredTurn>,
    prompts: &[PreferredPrompt],
) -> Option<Vec<usize>> {
    if prompts.is_empty() || prompts.len() > turns.len() {
        return None;
    }
    let mut left = Vec::with_capacity(prompts.len());
    let mut cursor = 0_usize;
    for prompt in prompts {
        let index =
            (cursor..turns.len()).find(|index| turns[*index].user_prompt == prompt.prompt_text)?;
        left.push(index);
        cursor = index + 1;
    }

    let mut right = vec![0_usize; prompts.len()];
    let mut end = turns.len();
    for prompt_index in (0..prompts.len()).rev() {
        let index = (0..end)
            .rev()
            .find(|index| turns[*index].user_prompt == prompts[prompt_index].prompt_text)?;
        right[prompt_index] = index;
        end = index;
    }
    (left == right && left.last().copied() == Some(turns.len() - 1)).then_some(left)
}

fn retain_parsed_turn(
    turns: &mut VecDeque<StoredTurn>,
    turn: StoredTurn,
    fallback_limit: usize,
    reconciliation_byte_cap: Option<usize>,
    hybrid_eligible: &mut bool,
    reconciliation_bytes: &mut usize,
) {
    if *hybrid_eligible {
        let turn_bytes = turn.retained_bytes();
        let cap = reconciliation_byte_cap.unwrap_or(0);
        if turn.oversized
            || turns.len() >= MAX_RECONCILIATION_TURNS
            || reconciliation_bytes.saturating_add(turn_bytes) > cap
        {
            *hybrid_eligible = false;
            *reconciliation_bytes = 0;
            retain_recent_turn(turns, turn, fallback_limit);
        } else {
            *reconciliation_bytes += turn_bytes;
            turns.push_back(turn);
        }
    } else {
        retain_recent_turn(turns, turn, fallback_limit);
    }
}

fn retain_recent_turn(turns: &mut VecDeque<StoredTurn>, turn: StoredTurn, limit: usize) {
    turns.push_back(turn);
    while turns.len() > limit {
        turns.pop_front();
    }
}

struct AcceptedMessage {
    role: MessageRole,
    timestamp: Option<String>,
    text: String,
}

enum MessageRole {
    User,
    Assistant,
}

fn accepted_message(value: &Value, tool: SessionTool) -> Option<AcceptedMessage> {
    match tool {
        SessionTool::ClaudeCode => accepted_claude_message(value),
        SessionTool::Codex => accepted_codex_message(value),
    }
}

fn accepted_claude_message(value: &Value) -> Option<AcceptedMessage> {
    let object = value.as_object()?;
    if object.get("isMeta").and_then(Value::as_bool) == Some(true) {
        return None;
    }
    let role = match object.get("type")?.as_str()? {
        "user" => MessageRole::User,
        "assistant" => MessageRole::Assistant,
        _ => return None,
    };
    let message = object.get("message")?.as_object()?;
    let message_role = message.get("role").and_then(Value::as_str)?;
    if !matches!(
        (&role, message_role),
        (MessageRole::User, "user") | (MessageRole::Assistant, "assistant")
    ) {
        return None;
    }
    let text = text_from_content(message.get("content")?, |block_type| block_type == "text")?;
    if matches!(role, MessageRole::User) && is_claude_command_noise(&text) {
        return None;
    }
    Some(AcceptedMessage {
        role,
        timestamp: bounded_timestamp(object.get("timestamp")),
        text,
    })
}

fn is_claude_command_noise(text: &str) -> bool {
    let trimmed = text.trim_start();
    [
        "<local-command-",
        "<command-name>",
        "<command-message>",
        "<command-args>",
    ]
    .iter()
    .any(|prefix| trimmed.starts_with(prefix))
}

fn accepted_codex_message(value: &Value) -> Option<AcceptedMessage> {
    let object = value.as_object()?;
    if object.get("type")?.as_str()? != "response_item" {
        return None;
    }
    let payload = object.get("payload")?.as_object()?;
    if payload.get("type")?.as_str()? != "message" {
        return None;
    }
    let (role, content_type) = match payload.get("role")?.as_str()? {
        "user" => (MessageRole::User, "input_text"),
        "assistant" => (MessageRole::Assistant, "output_text"),
        _ => return None,
    };
    let text = text_from_content(payload.get("content")?, |block_type| {
        block_type == content_type
    })?;
    Some(AcceptedMessage {
        role,
        timestamp: bounded_timestamp(object.get("timestamp")),
        text,
    })
}

fn text_from_content(content: &Value, accepted_type: impl Fn(&str) -> bool) -> Option<String> {
    if let Some(text) = content.as_str() {
        return (!text.trim().is_empty()).then(|| text.to_owned());
    }
    let parts = content
        .as_array()?
        .iter()
        .filter_map(|block| {
            let block = block.as_object()?;
            let block_type = block.get("type")?.as_str()?;
            if !accepted_type(block_type) {
                return None;
            }
            block
                .get("text")
                .and_then(Value::as_str)
                .filter(|text| !text.trim().is_empty())
                .map(str::to_owned)
        })
        .collect::<Vec<_>>();
    (!parts.is_empty()).then(|| parts.join("\n\n"))
}

fn bounded_timestamp(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty() && value.len() <= MAX_TIMESTAMP_BYTES)
        .map(str::to_owned)
}

struct PendingTurn {
    ordinal: u64,
    timestamp: Option<String>,
    user_prompt: String,
    assistant_parts: Vec<String>,
    accepted_bytes: usize,
    oversized: bool,
}

impl PendingTurn {
    fn new(ordinal: u64, timestamp: Option<String>, user_prompt: String) -> Self {
        let accepted_bytes = user_prompt.len();
        let oversized = accepted_bytes > MAX_ACCEPTED_TURN_BYTES;
        Self {
            ordinal,
            timestamp,
            user_prompt: if oversized {
                String::new()
            } else {
                user_prompt
            },
            assistant_parts: Vec::new(),
            accepted_bytes,
            oversized,
        }
    }

    fn push_assistant(&mut self, text: String) {
        let separator_bytes = usize::from(!self.assistant_parts.is_empty()) * 2;
        self.accepted_bytes = self
            .accepted_bytes
            .saturating_add(separator_bytes)
            .saturating_add(text.len());
        if self.accepted_bytes > MAX_ACCEPTED_TURN_BYTES {
            self.oversized = true;
            self.user_prompt.clear();
            self.assistant_parts.clear();
            return;
        }
        if !self.oversized {
            self.assistant_parts.push(text);
        }
    }

    fn finish(self) -> StoredTurn {
        StoredTurn {
            ordinal: self.ordinal,
            timestamp: self.timestamp,
            user_prompt: self.user_prompt,
            assistant_response: (!self.assistant_parts.is_empty())
                .then(|| self.assistant_parts.join("\n\n")),
            oversized: self.oversized,
        }
    }
}

struct StoredTurn {
    ordinal: u64,
    timestamp: Option<String>,
    user_prompt: String,
    assistant_response: Option<String>,
    oversized: bool,
}

impl StoredTurn {
    fn retained_bytes(&self) -> usize {
        self.timestamp.as_ref().map(String::len).unwrap_or(0)
            + self.user_prompt.len()
            + self
                .assistant_response
                .as_ref()
                .map(String::len)
                .unwrap_or(0)
    }

    fn into_session_turn(self) -> SessionTurn {
        SessionTurn {
            ordinal: self.ordinal,
            timestamp: self.timestamp,
            user_prompt: self.user_prompt,
            assistant_response: self.assistant_response,
        }
    }
}

fn stream_bounded_lines<R: BufRead>(
    reader: &mut R,
    mut on_line: impl FnMut(Option<&[u8]>) -> Result<(), TurnLogError>,
) -> io::Result<()> {
    let mut line = Vec::new();
    let mut oversized = false;
    loop {
        let available = reader.fill_buf()?;
        if available.is_empty() {
            if oversized {
                on_line(None).map_err(turn_log_io_error)?;
            } else if !line.is_empty() {
                trim_carriage_return(&mut line);
                on_line(Some(&line)).map_err(turn_log_io_error)?;
            }
            return Ok(());
        }
        let newline = available.iter().position(|byte| *byte == b'\n');
        let consumed = newline.map_or(available.len(), |index| index + 1);
        let content_length = newline.unwrap_or(available.len());
        if !oversized {
            if line.len().saturating_add(content_length) > MAX_LINE_BYTES {
                oversized = true;
                line.clear();
            } else {
                line.extend_from_slice(&available[..content_length]);
            }
        }
        reader.consume(consumed);
        if newline.is_some() {
            if oversized {
                on_line(None).map_err(turn_log_io_error)?;
            } else {
                trim_carriage_return(&mut line);
                on_line(Some(&line)).map_err(turn_log_io_error)?;
            }
            line.clear();
            oversized = false;
        }
    }
}

fn trim_carriage_return(line: &mut Vec<u8>) {
    if line.last() == Some(&b'\r') {
        line.pop();
    }
}

fn turn_log_io_error(error: TurnLogError) -> io::Error {
    io::Error::other(error.category())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use sqlx::Connection;
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    use std::io::{Cursor, ErrorKind, Write};
    use std::net::TcpListener;
    use std::os::unix::fs::symlink;
    use std::thread;
    use std::time::{Instant, SystemTime, UNIX_EPOCH};

    #[test]
    fn claude_pairs_all_text_and_excludes_tool_and_system_noise() {
        let input = json_lines(&[
            json!({"type":"system","message":{"role":"system","content":"noise"}}),
            json!({"type":"user","isMeta":true,"message":{"role":"user","content":"injected system context"}}),
            json!({"type":"user","message":{"role":"user","content":"<local-command-stdout>tool output</local-command-stdout>"}}),
            json!({"type":"user","timestamp":"2026-07-30T01:00:00Z","message":{"role":"user","content":[
                {"type":"text","text":"完整 prompt 第一段"},
                {"type":"tool_result","content":"secret tool output"},
                {"type":"text","text":"完整 prompt 第二段"}
            ]}}),
            json!({"type":"assistant","message":{"role":"assistant","content":[
                {"type":"text","text":"Agent 第一段"},
                {"type":"tool_use","name":"Read","input":{"path":"/tmp/nope"}}
            ]}}),
            json!({"type":"assistant","message":{"role":"assistant","content":"Agent 第二段"}}),
            json!({"type":"user","timestamp":"2026-07-30T01:01:00Z","message":{"role":"user","content":"下一個 prompt"}}),
            json!({"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"下一個回覆"}]}}),
        ]);

        let page = parse_turn_log(
            Cursor::new(input),
            SessionTool::ClaudeCode,
            11,
            DEFAULT_TURN_LIMIT,
        )
        .unwrap();

        assert_eq!(page.total_turns, 2);
        assert_eq!(page.turns.len(), 2);
        assert_eq!(
            page.turns[0].user_prompt,
            "完整 prompt 第一段\n\n完整 prompt 第二段",
        );
        assert_eq!(
            page.turns[0].assistant_response.as_deref(),
            Some("Agent 第一段\n\nAgent 第二段"),
        );
        assert!(!page.turns[0].user_prompt.contains("tool output"));
        assert!(!page.turns[0].user_prompt.contains("system context"));
        assert_eq!(page.turns[1].ordinal, 2);
    }

    #[test]
    fn overlong_timestamp_is_omitted_without_dropping_turn_content() {
        let prompt = "tiny prompt";
        let response = "tiny response";
        let text_bytes = prompt.len() + response.len();
        let input = json_lines(&[
            json!({
                "type":"user",
                "timestamp":"x".repeat(MAX_TIMESTAMP_BYTES + 1),
                "message":{"role":"user","content":prompt}
            }),
            json!({"type":"assistant","message":{"role":"assistant","content":response}}),
        ]);
        let parsed = parse_raw_turn_log(
            Cursor::new(input),
            SessionTool::ClaudeCode,
            12,
            DEFAULT_TURN_LIMIT,
            Some(text_bytes),
        )
        .unwrap();

        assert!(parsed.hybrid_eligible);
        assert_eq!(parsed.turns[0].timestamp, None);
        assert_eq!(parsed.turns[0].retained_bytes(), text_bytes);

        let page = project_turn_log(parsed, DEFAULT_TURN_LIMIT, None).unwrap();
        assert_eq!(page.turns[0].timestamp, None);
        assert_eq!(page.turns[0].user_prompt, prompt);
        assert_eq!(page.turns[0].assistant_response.as_deref(), Some(response),);

        let bounded_timestamp = "2026-07-30T01:00:00Z";
        let bounded_input = json_lines(&[
            json!({
                "type":"user",
                "timestamp":bounded_timestamp,
                "message":{"role":"user","content":prompt}
            }),
            json!({"type":"assistant","message":{"role":"assistant","content":response}}),
        ]);
        let bounded = parse_raw_turn_log(
            Cursor::new(bounded_input),
            SessionTool::ClaudeCode,
            13,
            DEFAULT_TURN_LIMIT,
            Some(text_bytes),
        )
        .unwrap();
        assert!(!bounded.hybrid_eligible);
        assert_eq!(
            bounded.turns[0].retained_bytes(),
            text_bytes + bounded_timestamp.len(),
        );
    }

    #[test]
    fn codex_pairs_response_items_and_ignores_function_and_developer_noise() {
        let input = json_lines(&[
            json!({"type":"response_item","timestamp":"2026-07-30T02:00:00Z","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"Codex prompt"}]}}),
            json!({"type":"response_item","payload":{"type":"function_call","name":"exec","arguments":"secret"}}),
            json!({"type":"response_item","payload":{"type":"message","role":"developer","content":[{"type":"input_text","text":"system noise"}]}}),
            json!({"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"第一個 response"}]}}),
            json!({"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"第二個 response"}]}}),
        ]);

        let page = parse_turn_log(
            Cursor::new(input),
            SessionTool::Codex,
            22,
            DEFAULT_TURN_LIMIT,
        )
        .unwrap();

        assert_eq!(page.total_turns, 1);
        assert_eq!(page.turns[0].user_prompt, "Codex prompt");
        assert_eq!(
            page.turns[0].assistant_response.as_deref(),
            Some("第一個 response\n\n第二個 response"),
        );
    }

    #[test]
    fn canonical_filename_derives_only_recognized_claude_and_codex_session_ids() {
        let session_id = "019fabc5-2c1a-7ad2-a564-a3d9c8fd5aad";
        assert_eq!(
            content_session_id_from_source(
                SessionTool::ClaudeCode,
                Path::new(&format!("/tmp/{session_id}.jsonl")),
            )
            .as_deref(),
            Some(session_id),
        );
        assert_eq!(
            content_session_id_from_source(
                SessionTool::Codex,
                Path::new(&format!(
                    "/tmp/rollout-2026-07-30T12-34-56-{session_id}.jsonl"
                )),
            )
            .as_deref(),
            Some(session_id),
        );
        assert!(content_session_id_from_source(
            SessionTool::ClaudeCode,
            Path::new("/tmp/session.jsonl"),
        )
        .is_none());
        assert!(content_session_id_from_source(
            SessionTool::Codex,
            Path::new(&format!(
                "/tmp/not-rollout-2026-07-30T12-34-56-{session_id}.jsonl"
            )),
        )
        .is_none());
        assert!(content_session_id_from_source(
            SessionTool::Codex,
            Path::new(&format!(
                "/tmp/rollout-2026-07-30-12-34-56-{session_id}.jsonl"
            )),
        )
        .is_none());
    }

    #[test]
    fn preferred_prompts_select_unique_nine_of_eleven_raw_turns_with_raw_responses() {
        let human_raw_indices = [1_usize, 2, 4, 5, 6, 7, 9, 10, 11];
        let mut values = Vec::new();
        for raw_index in 1..=11 {
            let prompt = if human_raw_indices.contains(&raw_index) {
                format!("human prompt {raw_index}")
            } else {
                format!("injected context {raw_index}")
            };
            values.push(json!({
                "type":"user",
                "timestamp":format!("2026-07-30T12:{raw_index:02}:00Z"),
                "message":{"role":"user","content":prompt}
            }));
            values.push(json!({
                "type":"assistant",
                "message":{"role":"assistant","content":format!("raw response {raw_index}")}
            }));
        }
        let preferred = human_raw_indices
            .iter()
            .enumerate()
            .map(|(index, raw_index)| PreferredPrompt {
                prompt_number: index as u64 + 1,
                prompt_text: format!("human prompt {raw_index}"),
                created_at_epoch: 1_000 + index as i64,
            })
            .collect::<Vec<_>>();
        let parsed = parse_raw_turn_log(
            Cursor::new(json_lines(&values)),
            SessionTool::ClaudeCode,
            81,
            DEFAULT_TURN_LIMIT,
            Some(MAX_RECONCILIATION_BYTES),
        )
        .unwrap();

        let page = project_turn_log(parsed, DEFAULT_TURN_LIMIT, Some(&preferred)).unwrap();

        assert_eq!(page.total_turns, 9);
        assert_eq!(page.turns.len(), 9);
        assert!(page
            .turns
            .iter()
            .all(|turn| !turn.user_prompt.contains("injected context")));
        assert_eq!(page.turns[2].ordinal, 3);
        assert_eq!(page.turns[2].user_prompt, "human prompt 4");
        assert_eq!(
            page.turns[2].assistant_response.as_deref(),
            Some("raw response 4"),
        );
    }

    #[test]
    fn codex_preferred_prompts_keep_only_exact_human_turns_and_raw_pairings() {
        let input = json_lines(&[
            json!({"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"Codex human one"}]}}),
            json!({"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"Codex response one"}]}}),
            json!({"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"injected Codex context"}]}}),
            json!({"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"Codex human two"}]}}),
            json!({"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"Codex response two"}]}}),
        ]);
        let preferred = vec![
            preferred_prompt(1, "Codex human one"),
            preferred_prompt(2, "Codex human two"),
        ];
        let parsed = parse_raw_turn_log(
            Cursor::new(input),
            SessionTool::Codex,
            84,
            DEFAULT_TURN_LIMIT,
            Some(MAX_RECONCILIATION_BYTES),
        )
        .unwrap();

        let page = project_turn_log(parsed, DEFAULT_TURN_LIMIT, Some(&preferred)).unwrap();

        assert_eq!(page.total_turns, 2);
        assert_eq!(page.turns[0].user_prompt, "Codex human one");
        assert_eq!(
            page.turns[1].assistant_response.as_deref(),
            Some("Codex response two"),
        );
        assert!(page
            .turns
            .iter()
            .all(|turn| !turn.user_prompt.contains("injected")));
    }

    #[test]
    fn mismatch_and_ambiguous_duplicate_prompt_runs_fall_back_to_raw_turns() {
        let mismatch_input = json_lines(&[
            json!({"type":"user","message":{"role":"user","content":"human one"}}),
            json!({"type":"assistant","message":{"role":"assistant","content":"response one"}}),
            json!({"type":"user","message":{"role":"user","content":"injected context"}}),
            json!({"type":"user","message":{"role":"user","content":"human two"}}),
            json!({"type":"assistant","message":{"role":"assistant","content":"response two"}}),
        ]);
        let mismatched = vec![
            preferred_prompt(1, "human one"),
            preferred_prompt(2, "different second prompt"),
        ];
        let parsed = parse_raw_turn_log(
            Cursor::new(mismatch_input),
            SessionTool::ClaudeCode,
            82,
            DEFAULT_TURN_LIMIT,
            Some(MAX_RECONCILIATION_BYTES),
        )
        .unwrap();
        let page = project_turn_log(parsed, DEFAULT_TURN_LIMIT, Some(&mismatched)).unwrap();
        assert_eq!(page.total_turns, 3);
        assert_eq!(page.turns[1].user_prompt, "injected context");

        let duplicate_input = json_lines(&[
            json!({"type":"user","message":{"role":"user","content":"same prompt"}}),
            json!({"type":"assistant","message":{"role":"assistant","content":"first pairing"}}),
            json!({"type":"user","message":{"role":"user","content":"same prompt"}}),
            json!({"type":"assistant","message":{"role":"assistant","content":"second pairing"}}),
        ]);
        let duplicate = vec![preferred_prompt(1, "same prompt")];
        let parsed = parse_raw_turn_log(
            Cursor::new(duplicate_input),
            SessionTool::ClaudeCode,
            83,
            DEFAULT_TURN_LIMIT,
            Some(MAX_RECONCILIATION_BYTES),
        )
        .unwrap();
        let page = project_turn_log(parsed, DEFAULT_TURN_LIMIT, Some(&duplicate)).unwrap();
        assert_eq!(page.total_turns, 2);
    }

    #[test]
    fn stale_preferred_prefix_falls_back_when_raw_has_a_newer_user_turn() {
        let input = json_lines(&[
            json!({"type":"user","message":{"role":"user","content":"human A"}}),
            json!({"type":"assistant","message":{"role":"assistant","content":"response A"}}),
            json!({"type":"user","message":{"role":"user","content":"human B"}}),
            json!({"type":"assistant","message":{"role":"assistant","content":"response B"}}),
            json!({"type":"user","message":{"role":"user","content":"human C"}}),
            json!({"type":"assistant","message":{"role":"assistant","content":"response C"}}),
        ]);
        let stale = vec![
            preferred_prompt(1, "human A"),
            preferred_prompt(2, "human B"),
        ];
        let parsed = parse_raw_turn_log(
            Cursor::new(input),
            SessionTool::ClaudeCode,
            85,
            DEFAULT_TURN_LIMIT,
            Some(MAX_RECONCILIATION_BYTES),
        )
        .unwrap();

        let page = project_turn_log(parsed, DEFAULT_TURN_LIMIT, Some(&stale)).unwrap();

        assert_eq!(page.total_turns, 3);
        assert_eq!(page.turns.len(), 3);
        assert_eq!(page.turns[2].user_prompt, "human C");
        assert_eq!(
            page.turns[2].assistant_response.as_deref(),
            Some("response C"),
        );
    }

    #[test]
    fn reconciliation_byte_cap_disables_hybrid_and_keeps_rolling_raw_fallback() {
        let values = (1..=4)
            .flat_map(|index| {
                [
                    json!({"type":"user","message":{"role":"user","content":format!("prompt-{index}-123456")}}),
                    json!({"type":"assistant","message":{"role":"assistant","content":format!("response-{index}-123456")}}),
                ]
            })
            .collect::<Vec<_>>();
        let preferred = (1..=4)
            .map(|index| preferred_prompt(index, &format!("prompt-{index}-123456")))
            .collect::<Vec<_>>();
        let parsed = parse_raw_turn_log(
            Cursor::new(json_lines(&values)),
            SessionTool::ClaudeCode,
            86,
            2,
            Some(48),
        )
        .unwrap();

        assert!(!parsed.hybrid_eligible);
        assert_eq!(parsed.total_turns, 4);
        assert_eq!(parsed.turns.len(), 2);
        assert_eq!(parsed.turns[0].user_prompt, "prompt-3-123456");
        assert_eq!(parsed.turns[1].user_prompt, "prompt-4-123456");

        let page = project_turn_log(parsed, 2, Some(&preferred)).unwrap();
        assert_eq!(page.total_turns, 4);
        assert_eq!(page.turns.len(), 2);
        assert_eq!(page.turns[0].ordinal, 3);
        assert_eq!(page.turns[1].user_prompt, "prompt-4-123456");
    }

    #[test]
    fn claude_mem_contract_uses_only_supported_pagination_and_platform_parameters() {
        let session_id = "019fabc5-2c1a-7ad2-a564-a3d9c8fd5aad";
        for (tool, expected_platform) in [
            (SessionTool::ClaudeCode, "claude"),
            (SessionTool::Codex, "codex"),
        ] {
            let prompt_page = json!({
                "items":[{
                    "id":1,
                    "content_session_id":session_id,
                    "project":"fixture",
                    "platform_source":expected_platform,
                    "prompt_number":1,
                    "prompt_text":"exact human prompt",
                    "created_at":"2026-07-30T12:00:00.000Z",
                    "created_at_epoch":1_000
                }],
                "hasMore":false,
                "offset":0,
                "limit":CLAUDE_MEM_PAGE_SIZE
            })
            .to_string();
            let (origin, server) = serve_http(vec![
                json_response(r#"{"version":"13.12.4"}"#),
                json_response(&prompt_page),
            ]);

            let prompts = tauri::async_runtime::block_on(fetch_claude_mem_prompts_at(
                &origin, tool, session_id,
            ))
            .unwrap();
            let requests = server.join().unwrap();

            assert_eq!(prompts.len(), 1);
            assert_eq!(prompts[0].prompt_text, "exact human prompt");
            assert_eq!(requests[0], "GET /api/version HTTP/1.1");
            assert!(requests[1].starts_with("GET /api/prompts?"));
            assert!(requests[1].contains("offset=0"));
            assert!(requests[1].contains("limit=100"));
            assert!(requests[1].contains(&format!("platformSource={expected_platform}")));
            assert!(!requests[1].contains("session"));
            assert!(!requests[1].contains("project"));
        }
    }

    #[test]
    fn unavailable_malformed_version_incompatible_and_oversized_api_fall_back() {
        let session_id = "019fabc5-2c1a-7ad2-a564-a3d9c8fd5aad";
        let unavailable = tauri::async_runtime::block_on(fetch_claude_mem_prompts_at(
            "http://127.0.0.1:1",
            SessionTool::ClaudeCode,
            session_id,
        ));
        assert!(unavailable.is_none());

        let (origin, server) = serve_http(vec![
            json_response(r#"{"version":"13.12.4"}"#),
            json_response(r#"{"items":"malformed"}"#),
        ]);
        assert!(tauri::async_runtime::block_on(fetch_claude_mem_prompts_at(
            &origin,
            SessionTool::ClaudeCode,
            session_id,
        ))
        .is_none());
        server.join().unwrap();

        let (origin, server) = serve_http(vec![json_response(r#"{"version":"14.0.0"}"#)]);
        assert!(tauri::async_runtime::block_on(fetch_claude_mem_prompts_at(
            &origin,
            SessionTool::ClaudeCode,
            session_id,
        ))
        .is_none());
        server.join().unwrap();

        let (origin, server) = serve_http(vec![
            json_response(r#"{"version":"13.12.4"}"#),
            oversized_response(MAX_CLAUDE_MEM_RESPONSE_BYTES + 1),
        ]);
        assert!(tauri::async_runtime::block_on(fetch_claude_mem_prompts_at(
            &origin,
            SessionTool::ClaudeCode,
            session_id,
        ))
        .is_none());
        server.join().unwrap();
    }

    #[test]
    #[ignore = "D-008 host action: read-only live DB, canonical JSONL, and localhost API smoke"]
    fn real_hybrid_source_matches_by_counts_and_hashes_without_content_output() {
        tauri::async_runtime::block_on(async {
            let session_id = std::env::var("DEBRIEF_D008_SESSION_ID")
                .ok()
                .and_then(|value| value.parse::<i64>().ok())
                .filter(|value| *value > 0)
                .expect("set DEBRIEF_D008_SESSION_ID to a mapped Debrief session");
            let home = PathBuf::from(std::env::var_os("HOME").expect("HOME is required"));
            let database = home.join(".debrief").join("debrief.db");
            let (tool, indexed_source) = query_session_source(&database, session_id).await.unwrap();
            let source = validate_source_path(&home, tool, &indexed_source).unwrap();
            let content_session_id =
                content_session_id_from_source(tool, &source).expect("recognized canonical name");
            let preferred = fetch_claude_mem_prompts(tool, &content_session_id)
                .await
                .expect("mapped claude-mem prompt run");
            let file = File::open(source).unwrap();
            let raw = parse_raw_turn_log(
                BufReader::new(file),
                tool,
                session_id,
                DEFAULT_TURN_LIMIT,
                Some(MAX_RECONCILIATION_BYTES),
            )
            .unwrap();
            assert!(raw.hybrid_eligible);
            assert_eq!(raw.total_turns, raw.turns.len() as u64);
            let indices =
                unique_exact_subsequence(&raw.turns, &preferred).expect("unique exact alignment");
            let visible_start = indices.len().saturating_sub(DEFAULT_TURN_LIMIT);
            let expected_hashes = indices[visible_start..]
                .iter()
                .zip(&preferred[visible_start..])
                .map(|(raw_index, prompt)| {
                    turn_content_hash(
                        &prompt.prompt_text,
                        raw.turns[*raw_index].assistant_response.as_deref(),
                    )
                })
                .collect::<Vec<_>>();
            let raw_count = raw.total_turns;
            let page = project_turn_log(raw, DEFAULT_TURN_LIMIT, Some(&preferred)).unwrap();
            let actual_hashes = page
                .turns
                .iter()
                .map(|turn| {
                    turn_content_hash(&turn.user_prompt, turn.assistant_response.as_deref())
                })
                .collect::<Vec<_>>();

            assert_eq!(page.total_turns, preferred.len() as u64);
            assert!(raw_count >= page.total_turns);
            assert_eq!(actual_hashes, expected_hashes);
        });
    }

    #[test]
    fn returns_only_the_latest_bounded_turn_page() {
        let input = json_lines(
            &(1..=4)
                .flat_map(|ordinal| {
                    [
                        json!({"type":"user","message":{"role":"user","content":format!("prompt {ordinal}")}}),
                        json!({"type":"assistant","message":{"role":"assistant","content":format!("response {ordinal}")}}),
                    ]
                })
                .collect::<Vec<_>>(),
        );

        let page = parse_turn_log(Cursor::new(input), SessionTool::ClaudeCode, 33, 2).unwrap();

        assert_eq!(page.total_turns, 4);
        assert!(page.has_earlier);
        assert_eq!(
            page.turns
                .iter()
                .map(|turn| turn.ordinal)
                .collect::<Vec<_>>(),
            vec![3, 4],
        );
    }

    #[test]
    fn oversized_line_is_discarded_before_later_valid_turns() {
        let mut input = vec![b'x'; MAX_LINE_BYTES + 1];
        input.push(b'\n');
        input.extend(json_lines(&[
            json!({"type":"user","message":{"role":"user","content":"still visible"}}),
            json!({"type":"assistant","message":{"role":"assistant","content":"still paired"}}),
        ]));

        let page = parse_turn_log(
            Cursor::new(input),
            SessionTool::ClaudeCode,
            44,
            DEFAULT_TURN_LIMIT,
        )
        .unwrap();

        assert_eq!(page.skipped_lines, 1);
        assert_eq!(page.turns.len(), 1);
        assert_eq!(page.turns[0].user_prompt, "still visible");
        assert_eq!(
            page.turns[0].assistant_response.as_deref(),
            Some("still paired"),
        );
    }

    #[test]
    fn accepted_turn_over_safety_cap_returns_truthful_error() {
        let input = json_lines(&[json!({
            "type":"user",
            "message":{"role":"user","content":"x".repeat(MAX_ACCEPTED_TURN_BYTES + 1)}
        })]);

        let error = parse_turn_log(
            Cursor::new(input),
            SessionTool::ClaudeCode,
            55,
            DEFAULT_TURN_LIMIT,
        )
        .unwrap_err();

        assert_eq!(error, TurnLogError::AcceptedTurnTooLarge);
        assert!(!error.user_message().contains('/'));
    }

    #[test]
    fn canonical_source_must_match_tool_root_and_jsonl_extension() {
        let home = temp_directory("turn-log-path");
        let claude_root = home.join(".claude").join("projects").join("fixture");
        let codex_root = home.join(".codex").join("sessions");
        let outside = home.join("outside");
        fs::create_dir_all(&claude_root).unwrap();
        fs::create_dir_all(&codex_root).unwrap();
        fs::create_dir_all(&outside).unwrap();
        let claude_source = claude_root.join("session.jsonl");
        let codex_source = codex_root.join("rollout.jsonl");
        let wrong_extension = claude_root.join("session.txt");
        let outside_source = outside.join("session.jsonl");
        fs::write(&claude_source, b"").unwrap();
        fs::write(&codex_source, b"").unwrap();
        fs::write(&wrong_extension, b"").unwrap();
        fs::write(&outside_source, b"").unwrap();
        let escaped_link = claude_root.join("escaped.jsonl");
        symlink(&outside_source, &escaped_link).unwrap();

        assert_eq!(
            validate_source_path(&home, SessionTool::ClaudeCode, &claude_source).unwrap(),
            fs::canonicalize(&claude_source).unwrap(),
        );
        assert!(matches!(
            validate_source_path(&home, SessionTool::Codex, &claude_source),
            Err(TurnLogError::SourceOutsideAllowedRoot),
        ));
        assert!(matches!(
            validate_source_path(&home, SessionTool::ClaudeCode, &wrong_extension),
            Err(TurnLogError::SourceOutsideAllowedRoot),
        ));
        assert!(matches!(
            validate_source_path(&home, SessionTool::ClaudeCode, &escaped_link),
            Err(TurnLogError::SourceOutsideAllowedRoot),
        ));

        fs::remove_dir_all(home).unwrap();
    }

    #[test]
    fn source_is_resolved_only_from_a_read_only_database_session_row() {
        tauri::async_runtime::block_on(async {
            let directory = temp_directory("turn-log-db");
            fs::create_dir_all(&directory).unwrap();
            let database_path = directory.join("debrief.db");
            let source_path = directory.join("session.jsonl");
            fs::write(&source_path, b"").unwrap();
            let options = SqliteConnectOptions::new()
                .filename(&database_path)
                .create_if_missing(true);
            let mut connection = SqliteConnection::connect_with(&options).await.unwrap();
            sqlx::raw_sql(include_str!("../../../core/migrations/001_initial.sql"))
                .execute(&mut connection)
                .await
                .unwrap();
            sqlx::query(
                "INSERT INTO projects (id, path, name) VALUES (1, '/tmp/project', 'Project')",
            )
            .execute(&mut connection)
            .await
            .unwrap();
            sqlx::query(
                "INSERT INTO sessions (id, project_id, tool, source_path)
                 VALUES (71, 1, 'codex', ?)",
            )
            .bind(source_path.to_string_lossy().to_string())
            .execute(&mut connection)
            .await
            .unwrap();
            connection.close().await.unwrap();

            let (tool, resolved) = query_session_source(&database_path, 71).await.unwrap();
            assert_eq!(tool, SessionTool::Codex);
            assert_eq!(resolved, source_path);
            assert_eq!(
                query_session_source(&database_path, 72).await.unwrap_err(),
                TurnLogError::SessionNotFound,
            );

            fs::remove_dir_all(directory).unwrap();
        });
    }

    fn json_lines(values: &[Value]) -> Vec<u8> {
        values
            .iter()
            .flat_map(|value| {
                let mut encoded = serde_json::to_vec(value).unwrap();
                encoded.push(b'\n');
                encoded
            })
            .collect()
    }

    fn preferred_prompt(prompt_number: u64, prompt_text: &str) -> PreferredPrompt {
        PreferredPrompt {
            prompt_number,
            prompt_text: prompt_text.to_owned(),
            created_at_epoch: prompt_number as i64,
        }
    }

    fn turn_content_hash(prompt: &str, assistant: Option<&str>) -> u64 {
        let mut hasher = DefaultHasher::new();
        prompt.hash(&mut hasher);
        assistant.hash(&mut hasher);
        hasher.finish()
    }

    fn serve_http(responses: Vec<Vec<u8>>) -> (String, thread::JoinHandle<Vec<String>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let address = listener.local_addr().unwrap();
        let handle = thread::spawn(move || {
            let mut requests = Vec::new();
            for response in responses {
                let deadline = Instant::now() + Duration::from_secs(2);
                let (mut stream, _) = loop {
                    match listener.accept() {
                        Ok(connection) => break connection,
                        Err(error)
                            if error.kind() == ErrorKind::WouldBlock
                                && Instant::now() < deadline =>
                        {
                            thread::sleep(Duration::from_millis(5));
                        }
                        Err(error) => panic!("bounded fixture accept failed: {error}"),
                    }
                };
                stream
                    .set_read_timeout(Some(Duration::from_secs(1)))
                    .unwrap();
                stream
                    .set_write_timeout(Some(Duration::from_secs(1)))
                    .unwrap();
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut request_line = String::new();
                reader.read_line(&mut request_line).unwrap();
                requests.push(request_line.trim_end().to_owned());
                let mut headers_complete = false;
                for _ in 0..64 {
                    let mut header = String::new();
                    reader.read_line(&mut header).unwrap();
                    if header == "\r\n" || header.is_empty() {
                        headers_complete = true;
                        break;
                    }
                }
                assert!(headers_complete, "bounded fixture header limit exceeded");
                stream.write_all(&response).unwrap();
            }
            requests
        });
        (format!("http://{address}"), handle)
    }

    fn json_response(body: &str) -> Vec<u8> {
        format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len(),
        )
        .into_bytes()
    }

    fn oversized_response(content_length: usize) -> Vec<u8> {
        format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {content_length}\r\nConnection: close\r\n\r\n",
        )
        .into_bytes()
    }

    fn temp_directory(label: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("debrief-{label}-{}-{nonce}", std::process::id(),))
    }
}
