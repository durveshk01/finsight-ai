package ai.finsight.verification;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;
import android.view.Gravity;
import android.widget.TextView;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;
import org.json.JSONObject;

/** Real Android share target: reads the URI using only the sender's permission grant. */
public final class ShareReceiverActivity extends Activity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        String status;
        try {
            Intent intent = getIntent();
            if (!Intent.ACTION_SEND.equals(intent.getAction())) {
                throw new IllegalArgumentException("Expected ACTION_SEND");
            }
            String mime = intent.getType();
            String extension;
            if ("application/pdf".equals(mime)) extension = "pdf";
            else if ("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet".equals(mime)) extension = "xlsx";
            else if ("text/csv".equals(mime)) extension = "csv";
            else if ("application/json".equals(mime)) extension = "json";
            else throw new IllegalArgumentException("Unexpected MIME type: " + mime);
            Uri uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (uri == null && intent.getClipData() != null && intent.getClipData().getItemCount() == 1) {
                uri = intent.getClipData().getItemAt(0).getUri();
            }
            if (uri == null || !"content".equals(uri.getScheme())
                    || !"ai.finsight.mobile.SharingFileProvider".equals(uri.getAuthority())
                    || !uri.getLastPathSegment().endsWith("." + extension)) {
                throw new IllegalArgumentException("Expected FinSight's shared file URI");
            }
            if ((intent.getFlags() & Intent.FLAG_GRANT_READ_URI_PERMISSION) == 0) {
                throw new IllegalArgumentException("Missing read URI permission grant");
            }
            File file = new File(getFilesDir(), "received." + extension);
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            long size = 0;
            try (InputStream input = getContentResolver().openInputStream(uri);
                    FileOutputStream output = new FileOutputStream(file)) {
                if (input == null) throw new IllegalArgumentException("Shared file could not be opened");
                byte[] buffer = new byte[16384];
                int count;
                while ((count = input.read(buffer)) != -1) {
                    output.write(buffer, 0, count);
                    digest.update(buffer, 0, count);
                    size += count;
                }
            }
            if (size == 0) throw new IllegalArgumentException("Received an empty file");
            StringBuilder sha256 = new StringBuilder();
            for (byte value : digest.digest()) sha256.append(String.format(Locale.ROOT, "%02x", value & 0xff));
            JSONObject evidence = new JSONObject();
            evidence.put("schema", "finsight.native-share.v1");
            evidence.put("action", intent.getAction());
            evidence.put("mime_type", mime);
            evidence.put("uri", uri.toString());
            evidence.put("flags", intent.getFlags());
            evidence.put("bytes", size);
            evidence.put("sha256", sha256.toString());
            try (FileOutputStream output = new FileOutputStream(new File(getFilesDir(), "received-" + extension + ".json"))) {
                output.write(evidence.toString(2).getBytes(StandardCharsets.UTF_8));
            }
            status = "Received " + extension.toUpperCase(Locale.ROOT) + " export";
            Log.i("FinSightVerify", status + ": " + size + " bytes, SHA-256 " + sha256);
        } catch (Exception error) {
            status = "Share verification failed: " + error.getMessage();
            Log.e("FinSightVerify", status, error);
        }
        TextView label = new TextView(this);
        label.setText(status);
        label.setTextSize(24);
        label.setTextColor(Color.BLACK);
        label.setBackgroundColor(Color.WHITE);
        label.setGravity(Gravity.CENTER);
        label.setPadding(32, 32, 32, 32);
        setContentView(label);
    }
}
