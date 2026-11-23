import subprocess, sys
# Cuts each line from the ElevenLabs take (start/end in seconds, from its word timings) and places it
# at the time PROMPT.md section 4 gives (place_at), building a 20.0 s, -16 LUFS stereo track per language.
# (start, end, place_at, tempo)
EN=[(0.00,2.45,0.30,1.0),(3.02,5.56,4.60,1.0),(6.14,8.30,8.60,1.0),(8.68,10.99,12.60,1.0),(11.31,12.93,15.45,1.0),(13.31,16.22,17.10,1.0)]
FR=[(0.12,2.46,0.30,1.0),(3.16,5.88,4.60,1.0),(6.38,8.76,8.60,1.0),(9.11,11.76,12.60,1.0),(12.00,13.76,15.33,1.0),(14.14,17.0,17.12,1.04)]
def build(src,segs,out):
    inputs=[];filt=[];labels=[]
    for i,(s,e,at,t) in enumerate(segs):
        f=f"[0:a]atrim={s}:{e},asetpts=PTS-STARTPTS,afade=t=in:d=0.03,afade=t=out:st={max(0,(e-s)-0.06)}:d=0.06"
        if t!=1.0: f+=f",atempo={t}"
        f+=f",adelay={int(at*1000)}|{int(at*1000)}[s{i}]"
        filt.append(f);labels.append(f"[s{i}]")
    filt.append("".join(labels)+f"amix=inputs={len(segs)}:normalize=0,apad=whole_dur=20,atrim=0:20,loudnorm=I=-16:TP=-1.5:LRA=11,aformat=sample_rates=48000:channel_layouts=stereo[out]")
    cmd=["ffmpeg","-y","-hide_banner","-loglevel","error","-i",src,"-filter_complex",";".join(filt),"-map","[out]","-ar","48000","-ac","2",out]
    subprocess.run(cmd,check=True)
build("FH-ad-EN-vo-take.mp3",EN,"FH-ad-EN-vo-20s.wav")
build("FH-ad-FR-vo-take.mp3",FR,"FH-ad-FR-vo-20s.wav")
