package com.u1.slicer

import com.u1.slicer.data.OverrideMode
import com.u1.slicer.data.SlicingOverrides
import org.json.JSONObject
import java.io.File
import java.util.zip.ZipFile

/**
 * A1 mini print gate. Checks the *actual* G-code against the verified
 * 3MF's effective support setting. Does not touch G-code or printer.
 */
internal object NightPrintV34Preflight {
    fun checkSupport(source: File?, gcodePath: String, overrides: SlicingOverrides): String? {
        if (source == null || !source.isFile ||
            !source.extension.equals("3mf", ignoreCase = true)) return null
        // Only apply this fail-closed gate to verified PETG 3MF projects.
        if (NightPrintImported3mfProfile.read(source) == null) return null
        val expectedInFile = try {
            ZipFile(source).use { zip ->
                val e = zip.getEntry("Metadata/project_settings.config")
                    ?: return "ナイト検査: 3MFのサポート設定がありません。"
                if (e.size !in 1L..65536L) return "ナイト検査: 3MF設定サイズが不正です。"
                JSONObject(zip.getInputStream(e).bufferedReader().use { it.readText() })
                    .optString("enable_support", "")
                    .trim()
            }
        } catch (ex: Exception) {
            return "ナイト検査: 3MFサポート設定の読込に失敗しました。"
        }
        val expected = when (overrides.supports.mode) {
            OverrideMode.OVERRIDE -> overrides.supports.value
                ?: return "ナイト検査: サポートの上書き値がありません。"
            OverrideMode.ORCA_DEFAULT -> false
            OverrideMode.USE_FILE -> when (expectedInFile.lowercase()) {
                "1", "true" -> true
                "0", "false", "" -> false // Old Orca projects inherit default OFF
                else -> return "ナイト検査: 3MFのサポート有無が不明です。"
            }
        }
        val file = File(gcodePath)
        if (!file.isFile || file.length() < 1024) return "ナイト検査: G-codeがありません。"
        val actual = try {
            java.io.RandomAccessFile(file, "r").use { stream ->
                val n = minOf(stream.length(), 300_000L).toInt()
                stream.seek(stream.length() - n)
                val tail = ByteArray(n)
                stream.readFully(tail)
                tail.toString(Charsets.UTF_8)
                    .lineSequence()
                    .lastOrNull { it.startsWith("; enable_support = ") }
                    ?.substringAfter("= ")?.trim()?.lowercase()
            }
        } catch (_: Exception) { null }
        val actualOn = when (actual) {
            "1", "true" -> true
            "0", "false" -> false
            else -> return "ナイト検査: G-codeのサポート設定が不明です。"
        }
        if (actualOn != expected) {
            return "ナイト検査: サポート不一致（3MF/上書き=" +
                (if (expected) "ON" else "OFF") +
                "、G-code=" + (if (actualOn) "ON" else "OFF") +
                "）。印刷を中止してください。"
        }
        return null
    }
}
