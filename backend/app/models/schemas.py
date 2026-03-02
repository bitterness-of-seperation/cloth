from pydantic import BaseModel


class TryOnRequest(BaseModel):
    person_image_url: str
    clothing_image_url: str


class TryOnResponse(BaseModel):
    result_image_base64: str
    message: str = "试穿合成成功"
    method: str = ""
    elapsed_sec: float = 0
