package com.u1.slicer

import com.u1.slicer.data.OverrideMode
import com.u1.slicer.data.OverrideValue
import com.u1.slicer.data.SliceConfig
import com.u1.slicer.data.SlicingOverrides
import org.json.JSONObject
import java.io.File
import java.util.zip.ZipEntry
import java.util.zip.ZipFile
import java.util.zip.ZipOutputStream

/**
 * Reconciles print-process settings for a verified, single-material PETG 3MF.
 *
 * The source geometry and filament temperature are never modified. Only
 * process fields with an explicit OVERRIDE or ORCA_DEFAULT are changed; all
 * USE_FILE settings are copied verbatim from the supplied 3MF. The original
 * file is never changed and no G-code or printer communication occurs here.
 */
internal object NightPrint3mfProcess {
    private const val MAX_CONFIG_SIZE = 64 * 1024
    private const val MAX_SINGLE_ENTRY = 120L * 1024 * 1024
    private const val MAX_UNCOMPRESSED = 250L * 1024 * 1024

    /**
     * After native slicing, compare the REAL G-code process footer against
     * the transient 3MF the engine was given. Metadata/Job History alone is
     * not sufficient evidence of the model instructions being honored.
     * Uses an exact set of validated single-material project keys.
     */
    fun checkOutput(profileFile: File, gcodeFile: String): String? = runCatching {
        val expected = ZipFile(profileFile).use { archive ->
            val entry = archive.getEntry("Metadata/project_settings.config")
                ?: return@runCatching "ナイト検査: 3MF設定が見つかりません。"
            require(entry.size in 1..MAX_CONFIG_SIZE.toLong()) {
                "3MF設定のサイズが不正です。"
            }
            JSONObject(archive.getInputStream(entry).bufferedReader().use { it.readText() })
        }
        val file = File(gcodeFile)
        require(file.isFile && file.length() > 1024) { "G-codeがありません。" }
        val footer = java.io.RandomAccessFile(file, "r").use { random ->
            val bytes = minOf(300_000L, random.length()).toInt()
            random.seek(random.length() - bytes)
            ByteArray(bytes).also { random.readFully(it) }.toString(Charsets.UTF_8)
        }
        fun gcodeValue(key: String): String? {
            val marker = "; " + key + " = "
            return footer.lineSequence().lastOrNull { it.startsWith(marker) }
                ?.removePrefix(marker)?.trim()
        }
        val exactKeys = listOf(
            "wall_loops",
            "top_shell_layers",
            "bottom_shell_layers",
            "sparse_infill_density",
            "sparse_infill_pattern",
            "enable_support"
        )
        for (key in exactKeys) {
            // In Orca profiles, an omitted enable_support inherits the
            // machine/process default OFF. Preserve V3.3 legacy projects
            // while still rejecting an actual support ON/OFF mismatch.
            val wanted = expected.optString(key).takeIf { it.isNotBlank() }
                ?: if (key == "enable_support") "0"
                   else return@runCatching "ナイト検査: 3MFの" + key + "が不足しています。"
            val actual = gcodeValue(key)
            if (actual != wanted) {
                return@runCatching "ナイト検査: " + key +
                    " は3MF=" + wanted + " / G-code=" + actual + "で不一致。印刷禁止。"
            }
        }
        val layer = expected.optString("layer_height").toFloatOrNull()
            ?: return@runCatching "ナイト検査: 3MF積層高さが不正です。"
        val initial = expected.optString("initial_layer_print_height").toFloatOrNull()
            ?: return@runCatching "ナイト検査: 3MF初層高さが不正です。"
        if (layer !in 0.08f..0.4f || kotlin.math.abs(layer - initial) > 0.0001f)
            return@runCatching "ナイト検査: 不規則な初層高さには未対応です。"
        val actualLayer = gcodeValue("layer_height")?.toFloatOrNull()
        if (actualLayer == null || kotlin.math.abs(layer - actualLayer) > 0.0001f) {
            return@runCatching "ナイト検査: 3MF積層高さ" + layer +
                "とG-code積層高さが一致しません。"
        }
        NightPrintGcodeGuard.checkA1MiniFixedLayers(gcodeFile, layer)
    }.getOrElse { "ナイト検査: 3MF設定照合に失敗しました: " + (it.message ?: "unknown") }

    fun prepare(
        input: File,
        output: File,
        overrides: SlicingOverrides,
        effective: SliceConfig,
    ): File {
        // A potentially malformed archive must be validated BEFORE trying
        // to read its material profile. Otherwise read() returning null can
        // bypass archive checks through the USE_FILE fast path.
        if (!input.extension.equals("3mf", ignoreCase = true)) return input
        require(input.canonicalPath != output.canonicalPath) {
            "元の3MFを上書きできません。"
        }
        // Never allow an untrusted archive entry to bypass inspection just
        // because there are no explicit process overrides (USE_FILE mode).
        // A verified PETG JSON alone does not make the surrounding ZIP safe.
        ZipFile(input).use { zip ->
            val seen = HashSet<String>()
            val entries = zip.entries().toList()
            require(entries.size in 1..2000) {
                "3MF内のファイル数が不正です。"
            }
            var totalBytes = 0L
            for (entry in entries) {
                val parts = entry.name.replace('\\', '/').split('/')
                require(seen.add(entry.name) &&
                    !entry.name.startsWith("/") &&
                    !entry.name.contains('\\') &&
                    parts.none { it == ".." || it == "." } &&
                    entry.size in 0..MAX_SINGLE_ENTRY) {
                    "3MF内部に不正なファイル名・サイズがあります。"
                }
                totalBytes += entry.size
                require(totalBytes <= MAX_UNCOMPRESSED) {
                    "3MFの展開サイズが上限を超えています。"
                }
            }
        }
        val before = NightPrintImported3mfProfile.read(input) ?: return input
        var changed = false
        val config = ZipFile(input).use { zip ->
            val entry = zip.getEntry("Metadata/project_settings.config")
                ?: return input
            require(entry.size in 1..MAX_CONFIG_SIZE.toLong()) {
                "3MFの設定情報が大きすぎます。"
            }
            val settings = JSONObject(zip.getInputStream(entry).use {
                String(it.readBytes(), Charsets.UTF_8)
            })
            fun <T> setProcess(
                key: String, option: OverrideValue<T>, value: String
            ) {
                if (option.mode == OverrideMode.USE_FILE) return
                if (settings.optString(key) != value) {
                    settings.put(key, value)
                    changed = true
                }
            }
            setProcess("layer_height", overrides.layerHeight,
                effective.layerHeight.toString())
            // NIGHT's layer-height setting is for the entire model, not just
            // later layers. Keep the first layer consistent for 100/125 tests.
            if (overrides.layerHeight.mode != OverrideMode.USE_FILE &&
                settings.optString("initial_layer_print_height") !=
                    effective.layerHeight.toString()
            ) {
                settings.put("initial_layer_print_height",
                    effective.layerHeight.toString())
                changed = true
            }
            setProcess("wall_loops", overrides.wallCount,
                effective.perimeters.toString())
            setProcess("top_shell_layers", overrides.topShellLayers,
                effective.topSolidLayers.toString())
            setProcess("bottom_shell_layers", overrides.bottomShellLayers,
                effective.bottomSolidLayers.toString())
            setProcess("sparse_infill_density", overrides.infillDensity,
                kotlin.math.round(effective.fillDensity * 100f).toInt().toString() + "%")
            setProcess("sparse_infill_pattern", overrides.infillPattern,
                effective.fillPattern)
            // V3.4: A support UI override must also reach the transient 3MF.
            // V3.3 only applied walls/infill; support ON could be silently lost.
            setProcess("enable_support", overrides.supports,
                if (effective.supportEnabled) "1" else "0")
            setProcess("support_type", overrides.supportType, effective.supportType)
            setProcess("support_on_build_plate_only", overrides.supportBuildPlateOnly,
                if (overrides.supportBuildPlateOnly.mode == OverrideMode.OVERRIDE)
                    if (overrides.supportBuildPlateOnly.value == true) "1" else "0"
                else if (overrides.supportBuildPlateOnly.mode == OverrideMode.ORCA_DEFAULT)
                    "0" else settings.optString("support_on_build_plate_only", "0"))
            if (overrides.bedTemp.mode != OverrideMode.USE_FILE) {
                for (key in arrayOf(
                    "textured_plate_temp", "textured_plate_temp_initial_layer",
                    "hot_plate_temp", "hot_plate_temp_initial_layer"
                )) {
                    val newValue = effective.bedTemp.toString()
                    val previous = settings.optJSONArray(key)?.optString(0)
                    if (previous != newValue) {
                        settings.put(key, org.json.JSONArray().put(newValue))
                        changed = true
                    }
                }
            }
            settings.toString().toByteArray(Charsets.UTF_8)
        }
        if (!changed) return input
        require(config.size in 1..MAX_CONFIG_SIZE) { "3MFの設定情報が大きすぎます。" }
        output.parentFile?.mkdirs()
        val temporary = File(output.parentFile, output.name + ".partial.3mf")
        temporary.delete()
        try {
            ZipFile(input).use { source ->
                ZipOutputStream(temporary.outputStream().buffered()).use { target ->
                    val seen = HashSet<String>()
                    var total = 0L
                    val entries = source.entries().toList()
                    require(entries.size <= 2000) { "3MFのファイル数が上限を超えています。" }
                    for (entry in entries) {
                        require(seen.add(entry.name) &&
                            !entry.name.startsWith("/") &&
                            entry.name.split('/').none { it == ".." }) {
                            "3MFに不正なファイル名があります。"
                        }
                        require(entry.size in 0..MAX_SINGLE_ENTRY) {
                            "3MFの内部ファイルが大きすぎます。"
                        }
                        total += entry.size
                        require(total <= MAX_UNCOMPRESSED) {
                            "3MFの展開データが大きすぎます。"
                        }
                        target.putNextEntry(ZipEntry(entry.name))
                        if (entry.name == "Metadata/project_settings.config") {
                            target.write(config)
                        } else {
                            source.getInputStream(entry).use { data ->
                                data.copyTo(target, bufferSize = 16 * 1024)
                            }
                        }
                        target.closeEntry()
                    }
                }
            }
            val after = NightPrintImported3mfProfile.read(temporary)
                ?: error("更新後の3MFからPETG設定を検証できません。")
            require(after == before) {
                "3MFのPETG温度や素材が変化しました。"
            }
            if (output.exists() && !output.delete()) {
                error("旧い中間3MFを削除できません。")
            }
            require(temporary.renameTo(output)) {
                "印刷設定を更新した3MFを保存できません。"
            }
            return output
        } finally {
            temporary.delete()
        }
    }
}
