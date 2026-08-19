export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      app_settings: {
        Row: {
          created_at: string
          id: boolean
          stream_rate_per_1000: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: boolean
          stream_rate_per_1000?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: boolean
          stream_rate_per_1000?: number
          updated_at?: string
        }
        Relationships: []
      }
      delivery_jobs: {
        Row: {
          apple_ticket: string | null
          approved_for_delivery: boolean
          attempts: number
          claimed_at: string | null
          created_at: string
          error_message: string | null
          finished_at: string | null
          id: string
          lease_until: string | null
          state: Database["public"]["Enums"]["delivery_state"]
          updated_at: string
          upload_id: string
          worker_id: string | null
        }
        Insert: {
          apple_ticket?: string | null
          approved_for_delivery?: boolean
          attempts?: number
          claimed_at?: string | null
          created_at?: string
          error_message?: string | null
          finished_at?: string | null
          id?: string
          lease_until?: string | null
          state?: Database["public"]["Enums"]["delivery_state"]
          updated_at?: string
          upload_id: string
          worker_id?: string | null
        }
        Update: {
          apple_ticket?: string | null
          approved_for_delivery?: boolean
          attempts?: number
          claimed_at?: string | null
          created_at?: string
          error_message?: string | null
          finished_at?: string | null
          id?: string
          lease_until?: string | null
          state?: Database["public"]["Enums"]["delivery_state"]
          updated_at?: string
          upload_id?: string
          worker_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "delivery_jobs_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_logs: {
        Row: {
          created_at: string
          id: number
          job_id: string
          level: string
          line: string
        }
        Insert: {
          created_at?: string
          id?: number
          job_id: string
          level?: string
          line: string
        }
        Update: {
          created_at?: string
          id?: number
          job_id?: string
          level?: string
          line?: string
        }
        Relationships: [
          {
            foreignKeyName: "delivery_logs_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "delivery_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_packages: {
        Row: {
          apple_ticket: string | null
          created_at: string
          error_message: string | null
          id: string
          job_id: string
          manifest: Json | null
          metadata_xml: string | null
          state: Database["public"]["Enums"]["delivery_state"]
          title: string | null
          updated_at: string
          upload_id: string
          vendor_id: string
        }
        Insert: {
          apple_ticket?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          job_id: string
          manifest?: Json | null
          metadata_xml?: string | null
          state?: Database["public"]["Enums"]["delivery_state"]
          title?: string | null
          updated_at?: string
          upload_id: string
          vendor_id: string
        }
        Update: {
          apple_ticket?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          job_id?: string
          manifest?: Json | null
          metadata_xml?: string | null
          state?: Database["public"]["Enums"]["delivery_state"]
          title?: string | null
          updated_at?: string
          upload_id?: string
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "delivery_packages_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "delivery_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_packages_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      isrc_pool: {
        Row: {
          assigned_at: string | null
          code: string
          created_at: string
          id: string
          used_by_track_id: string | null
        }
        Insert: {
          assigned_at?: string | null
          code: string
          created_at?: string
          id?: string
          used_by_track_id?: string | null
        }
        Update: {
          assigned_at?: string | null
          code?: string
          created_at?: string
          id?: string
          used_by_track_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "isrc_pool_track_fk"
            columns: ["used_by_track_id"]
            isOneToOne: false
            referencedRelation: "upload_tracks"
            referencedColumns: ["id"]
          },
        ]
      }
      items: {
        Row: {
          apple_id: string | null
          artist_name: string | null
          created_at: string
          id: string
          isrc: string | null
          item_type: Database["public"]["Enums"]["item_type"]
          sublabel_id: string
          title: string
          upc: string | null
          updated_at: string
        }
        Insert: {
          apple_id?: string | null
          artist_name?: string | null
          created_at?: string
          id?: string
          isrc?: string | null
          item_type?: Database["public"]["Enums"]["item_type"]
          sublabel_id: string
          title: string
          upc?: string | null
          updated_at?: string
        }
        Update: {
          apple_id?: string | null
          artist_name?: string | null
          created_at?: string
          id?: string
          isrc?: string | null
          item_type?: Database["public"]["Enums"]["item_type"]
          sublabel_id?: string
          title?: string
          upc?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "items_sublabel_id_fkey"
            columns: ["sublabel_id"]
            isOneToOne: false
            referencedRelation: "sublabels"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          sublabel_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          sublabel_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          sublabel_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_sublabel_id_fkey"
            columns: ["sublabel_id"]
            isOneToOne: false
            referencedRelation: "sublabels"
            referencedColumns: ["id"]
          },
        ]
      }
      report_runs: {
        Row: {
          error_message: string | null
          finished_at: string | null
          id: string
          kind: string
          report_date: string
          retry_count: number
          revenue_usd: number
          rows_matched: number
          rows_parsed: number
          rows_unmatched: number
          started_at: string
          status: Database["public"]["Enums"]["run_status"]
        }
        Insert: {
          error_message?: string | null
          finished_at?: string | null
          id?: string
          kind?: string
          report_date: string
          retry_count?: number
          revenue_usd?: number
          rows_matched?: number
          rows_parsed?: number
          rows_unmatched?: number
          started_at?: string
          status?: Database["public"]["Enums"]["run_status"]
        }
        Update: {
          error_message?: string | null
          finished_at?: string | null
          id?: string
          kind?: string
          report_date?: string
          retry_count?: number
          revenue_usd?: number
          rows_matched?: number
          rows_parsed?: number
          rows_unmatched?: number
          started_at?: string
          status?: Database["public"]["Enums"]["run_status"]
        }
        Relationships: []
      }
      sales: {
        Row: {
          country_code: string | null
          created_at: string
          id: string
          item_id: string
          original_currency: string | null
          product_type_id: string | null
          report_run_id: string | null
          revenue_original: number
          revenue_usd: number
          sale_date: string
          sublabel_id: string
          units: number
        }
        Insert: {
          country_code?: string | null
          created_at?: string
          id?: string
          item_id: string
          original_currency?: string | null
          product_type_id?: string | null
          report_run_id?: string | null
          revenue_original?: number
          revenue_usd?: number
          sale_date: string
          sublabel_id: string
          units?: number
        }
        Update: {
          country_code?: string | null
          created_at?: string
          id?: string
          item_id?: string
          original_currency?: string | null
          product_type_id?: string | null
          report_run_id?: string | null
          revenue_original?: number
          revenue_usd?: number
          sale_date?: string
          sublabel_id?: string
          units?: number
        }
        Relationships: [
          {
            foreignKeyName: "sales_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_sublabel_id_fkey"
            columns: ["sublabel_id"]
            isOneToOne: false
            referencedRelation: "sublabels"
            referencedColumns: ["id"]
          },
        ]
      }
      streams: {
        Row: {
          apple_identifier: string | null
          audio_format: string | null
          channel_partner: string | null
          container_id: string | null
          container_name: string | null
          container_sub_type: string | null
          container_type: string | null
          created_at: string
          device_type: string | null
          end_reason_type: string | null
          id: string
          ingest_date: string | null
          item_id: string
          offline: string | null
          report_run_id: string | null
          source_of_stream: string | null
          storefront_name: string | null
          stream_date: string
          streams: number
          sublabel_id: string
          subscription_mode: string | null
          subscription_type: string | null
          time_bucket: string | null
        }
        Insert: {
          apple_identifier?: string | null
          audio_format?: string | null
          channel_partner?: string | null
          container_id?: string | null
          container_name?: string | null
          container_sub_type?: string | null
          container_type?: string | null
          created_at?: string
          device_type?: string | null
          end_reason_type?: string | null
          id?: string
          ingest_date?: string | null
          item_id: string
          offline?: string | null
          report_run_id?: string | null
          source_of_stream?: string | null
          storefront_name?: string | null
          stream_date: string
          streams?: number
          sublabel_id: string
          subscription_mode?: string | null
          subscription_type?: string | null
          time_bucket?: string | null
        }
        Update: {
          apple_identifier?: string | null
          audio_format?: string | null
          channel_partner?: string | null
          container_id?: string | null
          container_name?: string | null
          container_sub_type?: string | null
          container_type?: string | null
          created_at?: string
          device_type?: string | null
          end_reason_type?: string | null
          id?: string
          ingest_date?: string | null
          item_id?: string
          offline?: string | null
          report_run_id?: string | null
          source_of_stream?: string | null
          storefront_name?: string | null
          stream_date?: string
          streams?: number
          sublabel_id?: string
          subscription_mode?: string | null
          subscription_type?: string | null
          time_bucket?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "streams_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "streams_report_run_id_fkey"
            columns: ["report_run_id"]
            isOneToOne: false
            referencedRelation: "report_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "streams_sublabel_id_fkey"
            columns: ["sublabel_id"]
            isOneToOne: false
            referencedRelation: "sublabels"
            referencedColumns: ["id"]
          },
        ]
      }
      sublabels: {
        Row: {
          contact_email: string | null
          created_at: string
          default_copyright_owner: string | null
          default_genre_code: string | null
          default_label_name: string | null
          default_language: string | null
          id: string
          is_active: boolean
          name: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          contact_email?: string | null
          created_at?: string
          default_copyright_owner?: string | null
          default_genre_code?: string | null
          default_label_name?: string | null
          default_language?: string | null
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          contact_email?: string | null
          created_at?: string
          default_copyright_owner?: string | null
          default_genre_code?: string | null
          default_label_name?: string | null
          default_language?: string | null
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      unmatched_sales: {
        Row: {
          artist_name: string | null
          country_code: string | null
          created_at: string
          id: string
          isrc: string | null
          original_currency: string | null
          product_type_id: string | null
          report_run_id: string | null
          resolved: boolean
          revenue_original: number
          revenue_usd: number
          sale_date: string
          title: string | null
          units: number
          upc: string | null
        }
        Insert: {
          artist_name?: string | null
          country_code?: string | null
          created_at?: string
          id?: string
          isrc?: string | null
          original_currency?: string | null
          product_type_id?: string | null
          report_run_id?: string | null
          resolved?: boolean
          revenue_original?: number
          revenue_usd?: number
          sale_date: string
          title?: string | null
          units?: number
          upc?: string | null
        }
        Update: {
          artist_name?: string | null
          country_code?: string | null
          created_at?: string
          id?: string
          isrc?: string | null
          original_currency?: string | null
          product_type_id?: string | null
          report_run_id?: string | null
          resolved?: boolean
          revenue_original?: number
          revenue_usd?: number
          sale_date?: string
          title?: string | null
          units?: number
          upc?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "unmatched_sales_report_run_id_fkey"
            columns: ["report_run_id"]
            isOneToOne: false
            referencedRelation: "report_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      unmatched_streams: {
        Row: {
          apple_identifier: string | null
          audio_format: string | null
          channel_partner: string | null
          container_id: string | null
          container_name: string | null
          container_sub_type: string | null
          container_type: string | null
          created_at: string
          device_type: string | null
          end_reason_type: string | null
          id: string
          ingest_date: string | null
          offline: string | null
          report_run_id: string | null
          resolved: boolean
          source_of_stream: string | null
          storefront_name: string | null
          stream_date: string
          streams: number
          subscription_mode: string | null
          subscription_type: string | null
          time_bucket: string | null
        }
        Insert: {
          apple_identifier?: string | null
          audio_format?: string | null
          channel_partner?: string | null
          container_id?: string | null
          container_name?: string | null
          container_sub_type?: string | null
          container_type?: string | null
          created_at?: string
          device_type?: string | null
          end_reason_type?: string | null
          id?: string
          ingest_date?: string | null
          offline?: string | null
          report_run_id?: string | null
          resolved?: boolean
          source_of_stream?: string | null
          storefront_name?: string | null
          stream_date: string
          streams?: number
          subscription_mode?: string | null
          subscription_type?: string | null
          time_bucket?: string | null
        }
        Update: {
          apple_identifier?: string | null
          audio_format?: string | null
          channel_partner?: string | null
          container_id?: string | null
          container_name?: string | null
          container_sub_type?: string | null
          container_type?: string | null
          created_at?: string
          device_type?: string | null
          end_reason_type?: string | null
          id?: string
          ingest_date?: string | null
          offline?: string | null
          report_run_id?: string | null
          resolved?: boolean
          source_of_stream?: string | null
          storefront_name?: string | null
          stream_date?: string
          streams?: number
          subscription_mode?: string | null
          subscription_type?: string | null
          time_bucket?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "unmatched_streams_report_run_id_fkey"
            columns: ["report_run_id"]
            isOneToOne: false
            referencedRelation: "report_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      upload_files: {
        Row: {
          bytes: number
          checksum: string | null
          content_type: string | null
          created_at: string
          duration_seconds: number | null
          filename: string
          id: string
          role: Database["public"]["Enums"]["upload_file_role"]
          storage_key: string
          upload_id: string
        }
        Insert: {
          bytes?: number
          checksum?: string | null
          content_type?: string | null
          created_at?: string
          duration_seconds?: number | null
          filename: string
          id?: string
          role?: Database["public"]["Enums"]["upload_file_role"]
          storage_key: string
          upload_id: string
        }
        Update: {
          bytes?: number
          checksum?: string | null
          content_type?: string | null
          created_at?: string
          duration_seconds?: number | null
          filename?: string
          id?: string
          role?: Database["public"]["Enums"]["upload_file_role"]
          storage_key?: string
          upload_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "upload_files_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      upload_tracks: {
        Row: {
          artist_name: string | null
          artwork_file_id: string | null
          created_at: string
          explicit: boolean
          file_id: string | null
          folder_number: number | null
          id: string
          isrc: string | null
          title: string
          track_number: number
          updated_at: string
          upload_id: string
          version: string | null
        }
        Insert: {
          artist_name?: string | null
          artwork_file_id?: string | null
          created_at?: string
          explicit?: boolean
          file_id?: string | null
          folder_number?: number | null
          id?: string
          isrc?: string | null
          title: string
          track_number?: number
          updated_at?: string
          upload_id: string
          version?: string | null
        }
        Update: {
          artist_name?: string | null
          artwork_file_id?: string | null
          created_at?: string
          explicit?: boolean
          file_id?: string | null
          folder_number?: number | null
          id?: string
          isrc?: string | null
          title?: string
          track_number?: number
          updated_at?: string
          upload_id?: string
          version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "upload_tracks_artwork_file_id_fkey"
            columns: ["artwork_file_id"]
            isOneToOne: false
            referencedRelation: "upload_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upload_tracks_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "upload_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upload_tracks_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      uploads: {
        Row: {
          admin_notes: string | null
          artist_name: string | null
          copyright_cline: string | null
          copyright_pline: string | null
          created_at: string
          created_by: string | null
          extract_error: string | null
          file_count: number
          genre_code: string | null
          id: string
          kind: Database["public"]["Enums"]["upload_kind"]
          label_name: string | null
          language: string | null
          rejection_reason: string | null
          release_date: string | null
          status: Database["public"]["Enums"]["upload_status"]
          storage_prefix: string
          sublabel_id: string
          title: string
          total_bytes: number
          upc: string | null
          updated_at: string
        }
        Insert: {
          admin_notes?: string | null
          artist_name?: string | null
          copyright_cline?: string | null
          copyright_pline?: string | null
          created_at?: string
          created_by?: string | null
          extract_error?: string | null
          file_count?: number
          genre_code?: string | null
          id?: string
          kind: Database["public"]["Enums"]["upload_kind"]
          label_name?: string | null
          language?: string | null
          rejection_reason?: string | null
          release_date?: string | null
          status?: Database["public"]["Enums"]["upload_status"]
          storage_prefix: string
          sublabel_id: string
          title: string
          total_bytes?: number
          upc?: string | null
          updated_at?: string
        }
        Update: {
          admin_notes?: string | null
          artist_name?: string | null
          copyright_cline?: string | null
          copyright_pline?: string | null
          created_at?: string
          created_by?: string | null
          extract_error?: string | null
          file_count?: number
          genre_code?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["upload_kind"]
          label_name?: string | null
          language?: string | null
          rejection_reason?: string | null
          release_date?: string | null
          status?: Database["public"]["Enums"]["upload_status"]
          storage_prefix?: string
          sublabel_id?: string
          title?: string
          total_bytes?: number
          upc?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "uploads_sublabel_id_fkey"
            columns: ["sublabel_id"]
            isOneToOne: false
            referencedRelation: "sublabels"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_delivery_job: {
        Args: { _lease_seconds?: number; _worker_id: string }
        Returns: {
          job_id: string
          upload_id: string
        }[]
      }
      current_sublabel_id: { Args: never; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      sales_summary: {
        Args: {
          _bucket: string
          _from: string
          _sublabel?: string
          _to: string
        }
        Returns: {
          bucket: string
          revenue_usd: number
          units: number
        }[]
      }
      streams_summary: {
        Args: {
          _bucket: string
          _from: string
          _sublabel?: string
          _to: string
        }
        Returns: {
          bucket: string
          revenue_usd: number
          streams: number
        }[]
      }
    }
    Enums: {
      app_role: "admin" | "sublabel"
      delivery_state:
        | "queued"
        | "claimed"
        | "packaging"
        | "uploading"
        | "succeeded"
        | "failed"
        | "awaiting_approval"
      item_type: "ringtone" | "single" | "album" | "other"
      run_status: "pending" | "success" | "not_ready" | "failed"
      upload_file_role: "audio" | "artwork" | "document" | "other"
      upload_kind: "album" | "singles" | "ringtones"
      upload_status:
        | "draft"
        | "uploaded"
        | "in_review"
        | "ready"
        | "packaging"
        | "delivering"
        | "delivered"
        | "rejected"
        | "cancelled"
        | "awaiting_approval"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "sublabel"],
      delivery_state: [
        "queued",
        "claimed",
        "packaging",
        "uploading",
        "succeeded",
        "failed",
        "awaiting_approval",
      ],
      item_type: ["ringtone", "single", "album", "other"],
      run_status: ["pending", "success", "not_ready", "failed"],
      upload_file_role: ["audio", "artwork", "document", "other"],
      upload_kind: ["album", "singles", "ringtones"],
      upload_status: [
        "draft",
        "uploaded",
        "in_review",
        "ready",
        "packaging",
        "delivering",
        "delivered",
        "rejected",
        "cancelled",
        "awaiting_approval",
      ],
    },
  },
} as const
