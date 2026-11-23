package app.rezka.tv;

import android.animation.ValueAnimator;
import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.RectF;
import android.view.View;
import android.view.animation.LinearInterpolator;

/**
 * A turning ring shown while the video buffers. It sits above the player controls and surrounds the play button when they are visible.
 * When the controls are hidden, a dark disc keeps it readable over bright video.
 */
final class BufferingRing extends View {
    private final Paint ring=new Paint(Paint.ANTI_ALIAS_FLAG),disc=new Paint(Paint.ANTI_ALIAS_FLAG);
    private final RectF bounds=new RectF();
    private final ValueAnimator spin=ValueAnimator.ofFloat(0f,360f);
    private boolean backdrop=true;
    BufferingRing(Context context){
        super(context);
        float density=context.getResources().getDisplayMetrics().density;
        ring.setStyle(Paint.Style.STROKE);ring.setStrokeWidth(3.5f*density);ring.setStrokeCap(Paint.Cap.ROUND);ring.setColor(0xFFEEE8E1);
        disc.setColor(0x73000000);
        spin.setDuration(1000);spin.setRepeatCount(ValueAnimator.INFINITE);spin.setInterpolator(new LinearInterpolator());spin.addUpdateListener(animation->invalidate());
        setFocusable(false);setClickable(false);setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_YES);setVisibility(GONE);
    }
    void setBackdrop(boolean visible){if(backdrop!=visible){backdrop=visible;invalidate();}}
    @Override public void onVisibilityAggregated(boolean visible){super.onVisibilityAggregated(visible);if(visible)spin.start();else spin.cancel();}
    @Override protected void onDetachedFromWindow(){spin.cancel();super.onDetachedFromWindow();}
    @Override protected void onDraw(Canvas canvas){
        float inset=ring.getStrokeWidth()/2;bounds.set(inset,inset,getWidth()-inset,getHeight()-inset);
        if(backdrop)canvas.drawOval(bounds,disc);
        canvas.drawArc(bounds,(Float)spin.getAnimatedValue()-90,270,false,ring);
    }
}
