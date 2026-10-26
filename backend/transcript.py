import re
from typing import Any

from youtube_transcript_api import YouTubeTranscriptApi


def extract_video_id(url: str) -> str | None:
    reg_exp = r'^.*(youtu.be/|v/|u/\w/|embed/|watch\?v=|&v=)([^#&?]*).*'
    match = re.match(reg_exp, url)
    if match and len(match.group(2)) == 11:
        return match.group(2)
    return None

def fetch_transcript(url: str, lang: str = 'en') -> list[dict[str, Any]]:
    video_id = extract_video_id(url)
    if not video_id:
        raise ValueError("Invalid YouTube URL")
    
    api = YouTubeTranscriptApi()
    try:
        transcript = api.fetch(video_id, languages=[lang, 'en'])
        # Convert to simple dict format
        result = []
        for line in transcript:
            result.append({
                'start': float(line.start) if hasattr(line, 'start') else float(getattr(line, 'start_time', 0)),
                'duration': float(line.duration) if hasattr(line, 'duration') else 0,
                'text': str(line.text) if hasattr(line, 'text') else ''
            })
        return result
    except Exception as e:
        raise e
