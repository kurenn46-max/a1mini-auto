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

    fun prepare(
        input: File,
        output: File,
        overrides: SlicingOverrides,
        effective: SliceConfig,
    ): File {
        val before = NightPrintImported3mfProfile.read(input) ?: return input
        require(input.canonicalPath != output.canonicalPath) {
            "元の3MFを上書きできません。"
        }
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
